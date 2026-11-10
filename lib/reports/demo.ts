import "server-only";
import { sql } from "../db";
import { migrate } from "../bootstrap";

/* Light demo data for the modules whose D365 source is a custom entity (vendor transactions, inventory transactions,
   bank, fixed assets, purchase lines, production output). Built from the company's real items, customers, vendors,
   sales and payments so the figures line up with the synced reports. Deterministic: the same company always gets
   the same rows. Volume is kept small (a few thousand rows per company). */

const YEAR = 2016;
const D0 = Date.UTC(YEAR, 0, 1);
const day = (n: number) => new Date(D0 + n * 86400000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VENDOR_NAMES = ["Fabrikam Electronics", "Litware Components", "Northwind Supplies", "Proseware Audio", "Wingtip Parts", "Tailspin Metals",
  "Adventure Plastics", "Lucerne Cables", "Coho Packaging", "Fourth Coffee Logistics", "Wide World Importers", "Alpine Ski Freight", "Contoso Cables", "Margie's Travel"];
const ASSETS: [string, string, number, number][] = [
  ["Buildings", "Warehouse building", 2400000, 480], ["Buildings", "Head office floor", 1350000, 480],
  ["Machinery", "Assembly line A", 640000, 120], ["Machinery", "Assembly line B", 590000, 120], ["Machinery", "Speaker test bench", 85000, 84],
  ["Machinery", "Packing machine", 120000, 96], ["Machinery", "CNC cutter", 210000, 120], ["Vehicles", "Delivery truck 1", 96000, 60],
  ["Vehicles", "Delivery truck 2", 96000, 60], ["Vehicles", "Delivery van", 54000, 60], ["Vehicles", "Forklift 1", 38000, 72],
  ["Vehicles", "Forklift 2", 38000, 72], ["Vehicles", "Sales car 1", 32000, 48], ["Vehicles", "Sales car 2", 32000, 48],
  ["Computers", "Servers", 72000, 36], ["Computers", "Laptops – sales", 28000, 36], ["Computers", "Laptops – finance", 18000, 36],
  ["Computers", "Network equipment", 24000, 48], ["Furniture", "Office furniture", 46000, 120], ["Furniture", "Showroom fit-out", 88000, 96],
  ["Furniture", "Warehouse racking", 64000, 120], ["Machinery", "Generator", 75000, 120],
];

export async function demoReady(company: string) {
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int n from d365.demo_items where company = ${company}`;
    return r.n > 0;
  } catch {
    return false;
  }
}

/** Create the demo rows for a company if it has none yet (also creates the tables on first use). */
export async function ensureDemo(company: string) {
  if (!company || (await demoReady(company))) return false;
  await migrate();
  if (await demoReady(company)) return false;
  await seedDemo(company);
  return true;
}

export async function seedDemo(company: string) {
  const R = rng([...company].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const between = (lo: number, hi: number) => lo + R() * (hi - lo);

  const items = await sql<{ item: string; name: string; grp: string; price: number; qty: number }[]>`
    select item, max(item_name) name, coalesce(max(nullif(category,'')), 'Other') grp, avg(price)::float price,
      greatest(1, coalesce(sum(qty) filter (where invoice_date between ${`${YEAR}-01-01`} and ${`${YEAR}-12-31`}), 0))::float qty
    from d365.invoice_lines where company = ${company} and price > 0 and coalesce(item,'') <> '' group by item order by sum(qty) desc limit 30`;
  if (!items.length) return;
  const whs = (await sql<{ w: string }[]>`select distinct warehouse w from d365.invoice_lines where company = ${company} and coalesce(warehouse,'') <> '' limit 4`).map((r) => r.w);
  const warehouses = whs.length ? whs : ["11", "12"];
  const site = (w: string) => (w.length >= 2 ? w.slice(0, 1) : "1");
  const realVendors = (await sql<{ v: string }[]>`select distinct vendor v from d365.purch_orders where company = ${company} and coalesce(vendor,'') <> '' limit 14`).map((r) => r.v);
  const vendors = (realVendors.length ? realVendors : VENDOR_NAMES.slice(0, 8).map((_, i) => `V-${100 + i}`)).map((v, i) => ({
    vendor: v, name: VENDOR_NAMES[i % VENDOR_NAMES.length], vend_group: i % 3 === 0 ? "Local" : i % 3 === 1 ? "Import" : "Services", terms_days: [30, 45, 60][i % 3] }));
  const buyers = (await sql<{ p: string }[]>`select distinct orderer p from d365.purch_orders where company = ${company} and coalesce(orderer,'') <> '' limit 4`).map((r) => r.p);

  const cost = new Map<string, number>();
  const itemRows = items.map((it, i) => {
    const c = r2(it.price * between(0.55, 0.72));
    cost.set(it.item, c);
    const monthly = it.qty / 12;
    return { company, item: it.item, name: it.name || it.item, item_group: it.grp, unit_cost: c, reorder_point: Math.round(monthly * 0.8),
      safety_stock: Math.round(monthly * 0.3), batch_tracked: i % 3 === 0 };
  });

  // Purchase order lines over the year: items picked in proportion to what sells, total bought ≈ 90% of a year's sales.
  const totalQty = items.reduce((a, i) => a + i.qty, 0);
  const wpick = () => { let x = R() * totalQty; for (const i of items) { x -= i.qty; if (x <= 0) return i; } return items[0]; };
  const LINES = 200;
  const pl: any[] = [];
  for (let n = 1; n <= 110; n++) {
    const od = day(Math.floor((n / 110) * 350));
    const v = pick(vendors);
    const lines = 1 + Math.floor(R() * 3);
    for (let l = 1; l <= lines; l++) {
      const it = wpick();
      const month = Number(od.slice(5, 7));
      const price = r2(cost.get(it.item)! * (0.96 + month * 0.006) * between(0.97, 1.04));
      const qty = Math.max(5, Math.round(((totalQty * 0.9) / LINES) * between(0.5, 1.5)));
      const dd = addDays(od, Math.round(between(7, 30)));
      const late = R() < 0.3 ? Math.round(between(1, 18)) : -Math.round(between(0, 4));
      const rd = addDays(dd, late);
      const received = rd <= `${YEAR}-12-15` && R() < 0.92;
      const recQty = received ? (R() < 0.12 ? Math.round(qty * between(0.5, 0.9)) : qty) : 0;
      const invQty = received && R() < 0.9 ? recQty : 0;
      pl.push({ company, purchase_order: `PO-${YEAR}-${String(n).padStart(4, "0")}`, line: l, vendor: v.vendor, item: it.item, qty, received_qty: recQty,
        invoiced_qty: invQty, price, order_date: od, delivery_date: dd, received_date: received ? rd : null, warehouse: pick(warehouses), buyer: buyers.length ? pick(buyers) : "" });
    }
  }

  // Vendor invoices and payments from the invoiced purchase lines.
  const vt: any[] = [];
  let vid = 0, vno = 0;
  const poInv = new Map<string, { vendor: string; date: string; amount: number }>();
  for (const p of pl.filter((x) => x.invoiced_qty > 0)) {
    const e = poInv.get(p.purchase_order) ?? { vendor: p.vendor, date: addDays(p.received_date, Math.round(between(0, 6))), amount: 0 };
    e.amount += p.invoiced_qty * p.price;
    poInv.set(p.purchase_order, e);
  }
  for (const [po, e] of poInv) {
    const v = vendors.find((x) => x.vendor === e.vendor)!;
    const due = addDays(e.date, v.terms_days);
    const amount = r2(e.amount);
    vno++;
    const inv = { company, id: ++vid, vendor: e.vendor, voucher: `APINV-${String(vno).padStart(5, "0")}`, invoice: `VI-${String(vno).padStart(5, "0")}`,
      trans_date: e.date, due_date: due, kind: "Invoice", amount: -amount, settled: 0, closed: null as string | null, paym_mode: "", purchase_order: po };
    const payDate = addDays(due, Math.round(between(-6, 12)));
    if (payDate <= `${YEAR}-12-31` && R() < 0.95) {
      const partial = R() < 0.06;
      const paid = partial ? r2(amount * between(0.4, 0.7)) : amount;
      inv.settled = -paid;
      inv.closed = partial ? null : payDate;
      vt.push({ company, id: ++vid, vendor: e.vendor, voucher: `APPAY-${String(vno).padStart(5, "0")}`, invoice: inv.invoice, trans_date: payDate, due_date: payDate,
        kind: "Payment", amount: paid, settled: paid, closed: payDate, paym_mode: R() < 0.7 ? "Bank transfer" : "Check", purchase_order: po });
    }
    vt.push(inv);
  }

  // Inventory transactions: opening, purchase receipts, sales (from real invoice lines), production, adjustments, transfers.
  const it2: any[] = [];
  let tid = 0;
  const sales = await sql<{ item: string; m: string; w: string; qty: number }[]>`
    select item, to_char(invoice_date,'YYYY-MM') m, coalesce(nullif(warehouse,''), ${warehouses[0]}) w, sum(qty)::float qty
    from d365.invoice_lines where company = ${company} and invoice_date between ${`${YEAR}-01-01`} and ${`${YEAR}-12-31`} group by 1,2,3`;
  for (const p of pl.filter((x) => x.received_qty > 0)) {
    const batch = itemRows.find((x) => x.item === p.item)!.batch_tracked;
    it2.push({ company, id: ++tid, item: p.item, site: site(p.warehouse), warehouse: p.warehouse, batch: batch ? `B${p.received_date.replace(/-/g, "").slice(2)}-${tid}` : null,
      expiry: batch ? addDays(p.received_date, Math.round(between(90, 540))) : null, trans_date: p.received_date, kind: "Purchase receipt", reference: p.purchase_order,
      qty: p.received_qty, cost_amount: r2(p.received_qty * p.price) });
  }
  for (const s of sales) {
    if (!cost.has(s.item)) continue;
    it2.push({ company, id: ++tid, item: s.item, site: site(s.w), warehouse: s.w, batch: null, expiry: null, trans_date: `${s.m}-${String(10 + Math.floor(R() * 15)).padStart(2, "0")}`,
      kind: "Sales issue", reference: `Sales ${s.m}`, qty: -s.qty, cost_amount: -r2(s.qty * cost.get(s.item)!) });
  }
  for (let k = 0; k < 40; k++) {
    const it = pick(items); const w = pick(warehouses); const d = day(Math.floor(between(5, 355)));
    const kind = k % 4 === 0 ? "Adjustment" : k % 4 === 1 ? "Counting" : k % 4 === 2 ? "Production receipt" : "Transfer";
    const q = kind === "Production receipt" ? Math.round(between(20, 200)) : kind === "Transfer" ? Math.round(between(10, 80)) : Math.round(between(-25, 12));
    const c = cost.get(it.item)!;
    if (kind === "Transfer") {
      const w2 = warehouses.find((x) => x !== w) ?? w;
      it2.push({ company, id: ++tid, item: it.item, site: site(w), warehouse: w, batch: null, expiry: null, trans_date: d, kind, reference: `TR-${k}`, qty: -q, cost_amount: -r2(q * c) });
      it2.push({ company, id: ++tid, item: it.item, site: site(w2), warehouse: w2, batch: null, expiry: null, trans_date: d, kind, reference: `TR-${k}`, qty: q, cost_amount: r2(q * c) });
    } else if (q !== 0) {
      it2.push({ company, id: ++tid, item: it.item, site: site(w), warehouse: w, batch: null, expiry: null, trans_date: d, kind, reference: `${kind.slice(0, 3).toUpperCase()}-${k}`, qty: q, cost_amount: r2(q * c) });
    }
  }

  // Opening balances sized so no item/warehouse goes below zero during the year (plus about two weeks of cover).
  const keys = new Map<string, { item: string; w: string; run: number; min: number }>();
  for (const t of [...it2].sort((a, b) => a.trans_date.localeCompare(b.trans_date))) {
    const k = `${t.item}|${t.warehouse}`;
    const e = keys.get(k) ?? { item: t.item, w: t.warehouse, run: 0, min: 0 };
    e.run += t.qty; e.min = Math.min(e.min, e.run); keys.set(k, e);
  }
  for (const it of items) for (const w of warehouses.slice(0, 2)) if (!keys.has(`${it.item}|${w}`)) keys.set(`${it.item}|${w}`, { item: it.item, w, run: 0, min: 0 });
  const opening: any[] = [];
  for (const e of keys.values()) {
    const it = items.find((x) => x.item === e.item)!;
    const q = Math.round(-e.min + (it.qty / 26) * between(0.3, 1.2));
    if (q <= 0) continue;
    const batch = itemRows.find((x) => x.item === e.item)!.batch_tracked;
    opening.push({ company, id: 0, item: e.item, site: site(e.w), warehouse: e.w, batch: batch ? `B${YEAR - 1}-${opening.length + 1}` : null,
      expiry: batch ? addDays(day(0), Math.round(between(45, 400))) : null, trans_date: day(0), kind: "Opening", reference: "Opening balance", qty: q, cost_amount: r2(q * cost.get(e.item)!) });
  }
  it2.unshift(...opening);
  // Batch-tracked items: issues use the oldest batch first (FIFO), so batch quantities are what is really left.
  const fifo: any[] = [];
  const queues = new Map<string, { batch: string; expiry: string | null; qty: number }[]>();
  for (const t of [...it2].sort((a, b) => a.trans_date.localeCompare(b.trans_date) || b.qty - a.qty)) {
    const batch = itemRows.find((x) => x.item === t.item)?.batch_tracked;
    if (!batch) { fifo.push(t); continue; }
    const k = `${t.item}|${t.warehouse}`;
    const q = queues.get(k) ?? []; queues.set(k, q);
    if (t.qty > 0) {
      const b = t.batch ?? `B${t.trans_date.replace(/-/g, "").slice(2)}-${fifo.length}`;
      const ex = t.expiry ?? addDays(t.trans_date, Math.round(between(90, 540)));
      q.push({ batch: b, expiry: ex, qty: t.qty }); fifo.push({ ...t, batch: b, expiry: ex });
    } else {
      let need = -t.qty; const unit = t.cost_amount / t.qty;
      while (need > 0.0001 && q.length) { const b = q[0]; const take = Math.min(need, b.qty); fifo.push({ ...t, batch: b.batch, expiry: b.expiry, qty: -take, cost_amount: r2(-take * unit) }); b.qty -= take; need -= take; if (b.qty <= 0.0001) q.shift(); }
      if (need > 0.0001) fifo.push({ ...t, qty: -need, cost_amount: r2(-need * unit) });
    }
  }
  it2.length = 0; fifo.forEach((t, i) => it2.push({ ...t, id: i + 1 }));
  tid = it2.length;

  // Bank: real customer receipts in, demo vendor payments out, payroll and expenses, a transfer each month.
  const bt: any[] = [];
  let bid = 0;
  const acc = [["USMF OPER", "Operating account"], ["USMF PAYROLL", "Payroll account"], ["USMF PETTY", "Petty cash"]];
  bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: day(0), kind: "Opening", description: "Opening balance", amount: 2500000 });
  bt.push({ company, id: ++bid, account: acc[1][0], account_name: acc[1][1], trans_date: day(0), kind: "Opening", description: "Opening balance", amount: 350000 });
  bt.push({ company, id: ++bid, account: acc[2][0], account_name: acc[2][1], trans_date: day(0), kind: "Opening", description: "Opening balance", amount: 15000 });
  const rec = await sql<{ d: string; account: string; amount: number }[]>`
    select trans_date::text d, account, (-amount_mst)::float amount from d365.cust_trans
    where company = ${company} and trans_type = 15 and trans_date between ${`${YEAR}-01-01`} and ${`${YEAR}-12-31`}`;
  for (const r of rec) bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: r.d, kind: "Customer receipt", description: `Receipt ${r.account}`, amount: r2(r.amount) });
  for (const p of vt.filter((x) => x.kind === "Payment")) bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: p.trans_date, kind: "Vendor payment", description: `Payment ${p.vendor}`, amount: -p.amount });
  for (let m = 1; m <= 12; m++) {
    const mm = `${YEAR}-${String(m).padStart(2, "0")}`;
    const payroll = r2(between(420000, 480000));
    bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: `${mm}-24`, kind: "Transfer", description: "Transfer to payroll", amount: -payroll });
    bt.push({ company, id: ++bid, account: acc[1][0], account_name: acc[1][1], trans_date: `${mm}-24`, kind: "Transfer", description: "Transfer from operating", amount: payroll });
    bt.push({ company, id: ++bid, account: acc[1][0], account_name: acc[1][1], trans_date: `${mm}-25`, kind: "Payroll", description: `Salaries ${mm}`, amount: -r2(payroll * between(0.97, 1)) });
    for (let k = 0; k < 4; k++) bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: `${mm}-${String(3 + k * 7).padStart(2, "0")}`, kind: "Expense", description: pick(["Rent", "Utilities", "Freight", "Insurance", "Marketing", "Bank charges"]), amount: -r2(between(8000, 65000)) });
    bt.push({ company, id: ++bid, account: acc[2][0], account_name: acc[2][1], trans_date: `${mm}-15`, kind: "Expense", description: "Petty cash spend", amount: -r2(between(1500, 6000)) });
    bt.push({ company, id: ++bid, account: acc[2][0], account_name: acc[2][1], trans_date: `${mm}-16`, kind: "Transfer", description: "Petty cash top-up", amount: 5000 });
    bt.push({ company, id: ++bid, account: acc[0][0], account_name: acc[0][1], trans_date: `${mm}-16`, kind: "Transfer", description: "Petty cash top-up", amount: -5000 });
  }

  // Fixed assets.
  const fa = ASSETS.map(([g, name, c, life], i) => {
    const acq = addDays(`${YEAR - 4}-01-01`, Math.round(between(0, 365 * 4.9)));
    const disposed = (g === "Vehicles" || g === "Computers") && i % 4 === 0 ? addDays(`${YEAR}-01-01`, Math.round(between(60, 330))) : null;
    return { company, asset: `FA-${String(i + 1).padStart(4, "0")}`, name, asset_group: g, location: pick(["Head office", "Warehouse", "Factory"]), acquisition_date: acq,
      cost: r2(c * between(0.9, 1.1)), life_months: life, salvage: 0, disposal_date: disposed, disposal_amount: disposed ? r2(c * between(0.15, 0.45)) : null };
  });

  // Production output against the real production orders.
  const po = await sql<{ prod_order: string; status: number; qty: number; delivery_date: string | null }[]>`select prod_order, status, qty::float, delivery_date::text from d365.prod_orders where company = ${company}`;
  const pout = po.map((p) => {
    const done = p.status >= 5 ? Math.round(p.qty * between(0.93, 1.03)) : p.status === 4 ? Math.round(p.qty * between(0.2, 0.7)) : 0;
    const plan = r2(p.qty * between(2, 6));
    return { company, prod_order: p.prod_order, qty_done: done, material_plan: plan, material_actual: p.status >= 4 ? r2(plan * (done / Math.max(1, p.qty)) * between(0.96, 1.12)) : 0,
      finished_date: p.status >= 5 && p.delivery_date ? addDays(p.delivery_date, Math.round(between(-4, 12))) : null };
  });

  await sql.begin(async (tx) => {
    for (const t of ["demo_items", "demo_vendors", "demo_purch_lines", "demo_vend_trans", "demo_invent_trans", "demo_bank_trans", "demo_assets", "demo_prod_output"])
      await tx`delete from ${tx("d365." + t)} where company = ${company}`;
    const ins = async (t: string, rows: any[]) => { for (let i = 0; i < rows.length; i += 500) await tx`insert into ${tx("d365." + t)} ${tx(rows.slice(i, i + 500))}`; };
    await ins("demo_items", itemRows);
    await ins("demo_vendors", vendors.map((v) => ({ company, ...v })));
    await ins("demo_purch_lines", pl);
    await ins("demo_vend_trans", vt);
    await ins("demo_invent_trans", it2);
    await ins("demo_bank_trans", bt);
    await ins("demo_assets", fa);
    if (pout.length) await ins("demo_prod_output", pout);
  });
  return { items: itemRows.length, purchLines: pl.length, vendTrans: vt.length, inventTrans: it2.length, bankTrans: bt.length, assets: fa.length, prod: pout.length };
}
