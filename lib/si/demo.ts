/**
 * Deterministic DEMO dataset for Sales Intelligence (spec §13).
 * One relational set of facts — orders → packing slips → invoices → credit notes → AR → settlements — from a fixed seed,
 * so every KPI on every grain is derived from the same rows. Company "dat" holds the data; "dat2" is intentionally empty.
 * Nothing here is presented as D365 data: every page shows a DEMO DATA badge while the company is in DEMO mode.
 */
import { addDays, toTime, toISO, weekday, addMonths } from "./time";

export const DEMO_SEED = 365_2026;
export const DEMO_AS_OF = "2026-11-10";
export const DEMO_FROM = "2023-11-01";

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
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface DemoData {
  territories: { code: string; name: string; region: string }[];
  channels: { code: string; name: string }[];
  warehouses: { code: string; name: string; site: string; territory: string }[];
  salespeople: { code: string; name: string; team: string; territory: string; manager: string }[];
  customers: { account: string; name: string; invoice_account: string; cust_group: string; segment: string; tier: string; parent: string; territory: string; channel: string; city: string; credit_limit: number; terms_days: number; currency: string; first_seen: string }[];
  products: { item: string; name: string; category: string; brand: string; item_group: string; uom: string; units_per_box: number; list_price: number; std_cost: number }[];
  orderLines: { order_id: string; line_no: number; customer: string; invoice_account: string; created: string; confirmed: string | null; requested_ship: string; confirmed_ship: string; item: string; qty: number; price: number; discount_pct: number; net_amount: number; currency: string; salesperson: string; channel: string; warehouse: string; status: string; cancelled_qty: number; cancelled_date: string | null; hold: string | null }[];
  slipLines: { slip_id: string; order_id: string; line_no: number; delivery_date: string; qty: number; value: number; warehouse: string }[];
  invoiceLines: { invoice_line_key: string; invoice_id: string; invoice_date: string; order_id: string | null; order_line: number | null; slip_id: string | null; customer: string; invoice_account: string; item: string; uom: string; qty: number; price: number; gross: number; discount: number; net: number; tax: number; cogs: number; cogs_restated: number; currency: string; fx_rate: number; net_mst: number; cogs_mst: number; salesperson: string; territory: string; channel: string; warehouse: string; doc_type: "invoice" | "credit"; credit_class: "physical_return" | "commercial_credit" | null; return_reason: string | null; original_invoice_line_key: string | null }[];
  arTrans: { trans_id: string; customer: string; doc_type: "invoice" | "credit" | "payment" | "advance"; doc_id: string; trans_date: string; due_date: string; amount: number }[];
  settlements: { settle_id: string; debit_trans: string; credit_trans: string; settle_date: string; amount: number; reversed_date: string | null }[];
  targets: { version: number; status: "approved" | "superseded"; salesperson: string; month: string; amount: number }[];
  fx: { from: string; to: string; date: string; rate: number }[];
}

const CITIES: [string, string, string][] = [
  ["CAI", "Cairo", "Greater Cairo"], ["GIZ", "Giza", "Greater Cairo"], ["ALX", "Alexandria", "North Coast"],
  ["DLT", "Delta", "Delta"], ["UPE", "Upper Egypt", "South"], ["CNL", "Canal", "Canal & Sinai"],
];
const CATS = ["Lighting", "Wiring Devices", "Cables", "Switchgear", "Panels", "Tools", "Smart Home", "Accessories"];
const BRANDS = ["Lumora", "Volta", "Nexa", "Ardent", "Qubit"];
const FIRST = ["Nour", "Delta", "Al Amal", "Horizon", "Nile", "Pyramid", "Sinai", "Green", "Atlas", "Orbit", "Cairo", "Royal", "Prime", "Union", "Star"];
const LAST = ["Trading", "Electric", "Distribution", "Supplies", "Group", "Contracting", "Stores", "Wholesale", "Systems", "Hub"];
const REPS = ["Ahmed Fathy", "Mona Salah", "Sherif Kamal", "Omar Hassan", "Nadia Adel", "Karim Samir", "Yara Mostafa", "Hany Ibrahim", "Dina Farouk", "Tarek Nabil", "Salma Reda", "Mahmoud Ezz"];
const RETURN_REASONS = ["Damaged in transit", "Defective", "Wrong item", "Customer changed mind"];

export function generateDemo(seed = DEMO_SEED): DemoData {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (a: number, b: number) => a + r() * (b - a);

  const territories = CITIES.map(([code, name, region]) => ({ code, name, region }));
  const channels = [{ code: "WHS", name: "Wholesale" }, { code: "RTL", name: "Retail" }, { code: "MDT", name: "Modern Trade" }];
  const warehouses = [
    { code: "CAI-01", name: "Cairo DC", site: "CAI", territory: "CAI" },
    { code: "ALX-01", name: "Alexandria DC", site: "ALX", territory: "ALX" },
    { code: "ASY-01", name: "Assiut DC", site: "UPE", territory: "UPE" },
  ];
  const whFor = (t: string) => (t === "ALX" || t === "DLT" ? "ALX-01" : t === "UPE" ? "ASY-01" : "CAI-01");

  const salespeople = REPS.map((name, i) => ({
    code: `SR${String(i + 1).padStart(3, "0")}`, name, team: i < 6 ? "Team North" : "Team South",
    territory: territories[i % territories.length].code, manager: i < 6 ? "Hossam Lotfy" : "Rania Gad",
  }));

  const customers: DemoData["customers"] = [];
  for (let i = 0; i < 92; i++) {
    const t = territories[i % territories.length];
    const ch = channels[i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0];
    const tier = i < 10 ? "A" : i < 35 ? "B" : "C";
    const acc = `C-${String(1001 + i)}`;
    customers.push({
      account: acc, name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}${i >= FIRST.length ? ` ${Math.floor(i / FIRST.length) + 1}` : ""}`,
      // S13: some customers are billed to a parent account
      invoice_account: i % 17 === 5 ? `C-${String(1001 + i - 1)}` : acc,
      cust_group: ch.code === "WHS" ? "WHOLESALE" : ch.code === "RTL" ? "RETAIL" : "MODERN",
      segment: tier === "A" ? "Key account" : tier === "B" ? "Core" : "Long tail", tier,
      parent: i % 10 === 0 ? "Nour Holding" : i % 13 === 0 ? "Delta Group" : "",
      territory: t.code, channel: ch.code, city: t.name,
      credit_limit: tier === "A" ? 4_000_000 : tier === "B" ? 1_500_000 : 400_000,
      terms_days: ch.code === "MDT" ? 60 : ch.code === "WHS" ? 45 : 30, currency: "EGP",
      // Staggered acquisition so "new customers" changes over time; the last 6 never buy (dormant prospects).
      first_seen: i < 86 ? addDays(DEMO_FROM, Math.floor(i * 11.5)) : "2099-01-01",
    });
  }

  const products: DemoData["products"] = [];
  for (let i = 0; i < 260; i++) {
    const cat = CATS[i % CATS.length];
    const brand = BRANDS[(i * 3) % BRANDS.length];
    const base = { Lighting: 120, "Wiring Devices": 45, Cables: 900, Switchgear: 1600, Panels: 5200, Tools: 380, "Smart Home": 1450, Accessories: 30 }[cat]!;
    const list = round2(base * between(0.6, 1.6));
    const marginTarget = between(0.18, 0.42);
    products.push({
      item: `${cat.slice(0, 3).toUpperCase()}-${String(1000 + i)}`, name: `${brand} ${cat} ${["Pro", "Max", "Lite", "Plus", "Eco"][i % 5]} ${100 + i}`,
      category: cat, brand, item_group: `${cat.slice(0, 3).toUpperCase()}-${["STD", "PRM"][i % 2]}`,
      uom: i % 9 === 0 ? "box" : "pcs", units_per_box: i % 9 === 0 ? 12 : 1, list_price: list, std_cost: round2(list * (1 - marginTarget)),
    });
  }
  // Popularity weights → a long tail (ABC classes come out naturally)
  const weights = products.map((_, i) => 1 / Math.pow(i + 3, 0.85));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => { let x = r() * wsum; for (let i = 0; i < products.length; i++) { x -= weights[i]; if (x <= 0) return products[i]; } return products[0]; };

  // FX: USD→EGP, daily, deterministic drift
  const fx: DemoData["fx"] = [];
  let usd = 30.9;
  for (let t = toTime(DEMO_FROM); t <= toTime(DEMO_AS_OF); t += 86400000) {
    const d = toISO(t);
    if (d === "2024-03-06") usd = 49.5; // devaluation step
    usd *= 1 + (r() - 0.5) * 0.002;
    fx.push({ from: "USD", to: "EGP", date: d, rate: round2(usd) });
  }
  const fxOn = (d: string) => fx[Math.max(0, Math.round((toTime(d) - toTime(DEMO_FROM)) / 86400000))].rate;

  const orderLines: DemoData["orderLines"] = [];
  const slipLines: DemoData["slipLines"] = [];
  const invoiceLines: DemoData["invoiceLines"] = [];
  const arTrans: DemoData["arTrans"] = [];
  const settlements: DemoData["settlements"] = [];
  let ordNo = 0, slipNo = 0, invNo = 0, cnNo = 0, payNo = 0, setNo = 0;

  // Salesperson by customer, with mid-period reassignment for some (S26 effective-dated attribution).
  const repFor = (c: (typeof customers)[number], d: string) => {
    const idx = customers.indexOf(c);
    const base = salespeople[(idx * 5) % salespeople.length].code;
    if (idx % 11 === 3 && d >= "2025-07-01") return salespeople[(idx * 5 + 1) % salespeople.length].code;
    return base;
  };

  const activeCustomers = (d: string) => customers.filter((c) => c.first_seen <= d);
  /** Share of the customer base already acquired — order volume grows with it. */
  const pool0 = (d: string) => activeCustomers(d).length / 86;
  // Restated cost: months whose inventory close raised cost after posting (S16).
  const restatedMonths = new Set(["2025-02", "2025-09", "2026-06"]);

  for (let t = toTime(DEMO_FROM); t <= toTime(DEMO_AS_OF); t += 86400000) {
    const d = toISO(t);
    const wd = weekday(d);
    if (wd === 5) continue; // Friday: no trading (S22 genuine zero)
    const yearsIn = (t - toTime(DEMO_FROM)) / (365 * 86400000);
    const month = Number(d.slice(5, 7));
    const season = 1 + 0.18 * Math.sin(((month - 3) / 12) * 2 * Math.PI) + (month === 12 ? 0.15 : 0);
    const dayFactor = wd === 6 ? 0.55 : wd === 4 ? 0.85 : 1;
    const mean = 4.7 * (1 + 0.14 * yearsIn) * (0.55 + 0.45 * pool0(d)) * season * dayFactor;
    const n = Math.max(0, Math.round(mean + (r() - 0.5) * 3));
    const pool = activeCustomers(d);
    if (!pool.length) continue;
    for (let k = 0; k < n; k++) {
      // Weighted by tier so adding small customers over time doesn't dilute the mix.
      const tw = pool.map((x) => (x.tier === "A" ? 6 : x.tier === "B" ? 2.5 : 1));
      let pickW = r() * tw.reduce((x, y) => x + y, 0), ci = 0;
      while (ci < pool.length - 1 && (pickW -= tw[ci]) > 0) ci++;
      const c = pool[ci];
      const order_id = `SO-${String(++ordNo).padStart(6, "0")}`;
      const lines = 1 + Math.floor(r() * (c.tier === "A" ? 5 : 3));
      const rep = repFor(c, d);
      const cur = c.channel === "MDT" && ordNo % 9 === 0 ? "USD" : "EGP"; // S11: some USD orders
      const rate = cur === "USD" ? fxOn(d) : 1;
      const wh = whFor(c.territory);
      const reqShip = addDays(d, 2 + Math.floor(r() * 6));
      const confShip = addDays(reqShip, r() < 0.25 ? Math.floor(r() * 5) : 0);
      const cancelled = r() < 0.03; // S04
      for (let ln = 1; ln <= lines; ln++) {
        const p = pickProduct();
        const qty = Math.max(1, Math.round((c.tier === "A" ? 40 : c.tier === "B" ? 18 : 7) * between(0.3, 1.7) * (p.list_price > 2000 ? 0.15 : p.list_price > 500 ? 0.4 : 1)));
        const disc = c.tier === "A" ? pick([0, 0.03, 0.05, 0.08]) : r() < 0.25 ? pick([0.02, 0.05]) : 0;
        const priceDrift = 1 + 0.07 * yearsIn + (r() - 0.5) * 0.04; // price increases over time
        const priceEgp = round2(p.list_price * priceDrift);
        const price = cur === "USD" ? round2(priceEgp / rate) : priceEgp;
        const net = round2(qty * price * (1 - disc));
        const ageDays = Math.round((toTime(DEMO_AS_OF) - t) / 86400000);
        // Recent orders stay open; a few older ones are stuck (backlog aging)
        const openState = ageDays < 6 ? "open" : ageDays < 20 && r() < 0.35 ? "open" : r() < 0.012 ? "open" : "done";
        const partialCancel = !cancelled && openState === "done" && r() < 0.02; // S05
        const hold = openState === "open" && r() < 0.08 ? pick(["Credit limit", "Overdue balance"]) : null;
        const ol = {
          order_id, line_no: ln, customer: c.account, invoice_account: c.invoice_account, created: d,
          confirmed: cancelled && r() < 0.5 ? null : addDays(d, r() < 0.7 ? 0 : 1),
          requested_ship: reqShip, confirmed_ship: confShip, item: p.item, qty, price, discount_pct: disc, net_amount: net,
          currency: cur, salesperson: rep, channel: c.channel, warehouse: wh,
          status: cancelled ? "cancelled" : openState === "open" ? "open" : "invoiced",
          cancelled_qty: cancelled ? qty : 0, cancelled_date: cancelled ? addDays(d, 1 + Math.floor(r() * 4)) : null, hold,
        };
        orderLines.push(ol);
        if (cancelled || openState === "open") continue;

        // Fulfilment: 1 slip normally; S02 split into 2 slips and 3 invoices for some lines
        const delivered = partialCancel ? Math.max(1, Math.round(qty * 0.6)) : qty;
        if (partialCancel) { ol.cancelled_qty = qty - delivered; ol.cancelled_date = addDays(confShip, 3); }
        const split = delivered >= 4 && r() < 0.07;
        const late = r() < 0.12 ? 1 + Math.floor(r() * 6) : 0;
        const slips = split ? [Math.ceil(delivered / 2), Math.floor(delivered / 2)] : [delivered];
        let slipDate = addDays(confShip, late);
        const invoicePieces: { qty: number; date: string; slip: string }[] = [];
        slips.forEach((sq, si) => {
          const slip_id = `PS-${String(++slipNo).padStart(6, "0")}`;
          if (si > 0) slipDate = addDays(slipDate, 3 + Math.floor(r() * 5));
          if (slipDate > DEMO_AS_OF) return; // not shipped yet
          slipLines.push({ slip_id, order_id, line_no: ln, delivery_date: slipDate, qty: sq, value: round2(sq * price * (1 - disc) * rate), warehouse: wh });
          const invLag = r() < 0.85 ? 0 : 1 + Math.floor(r() * 9);
          const invDate = addDays(slipDate, invLag);
          if (invDate > DEMO_AS_OF) return; // delivered not invoiced (FUL-003)
          if (split && si === 0 && sq >= 2) { // first slip invoiced in two pieces → 3 invoices total
            invoicePieces.push({ qty: Math.ceil(sq / 2), date: invDate, slip: slip_id }, { qty: Math.floor(sq / 2), date: addDays(invDate, 2), slip: slip_id });
          } else invoicePieces.push({ qty: sq, date: invDate, slip: slip_id });
        });
        for (const piece of invoicePieces) {
          if (piece.date > DEMO_AS_OF || piece.qty <= 0) continue;
          const invoice_id = `INV-${String(++invNo).padStart(6, "0")}`;
          const gross = round2(piece.qty * price);
          const lnet = round2(gross * (1 - disc));
          const costEgp = round2(piece.qty * p.std_cost * priceDrift * between(0.95, 1.05));
          const restated = restatedMonths.has(piece.date.slice(0, 7)) ? round2(costEgp * 1.04) : costEgp;
          const key = `${invoice_id}-1`;
          invoiceLines.push({
            invoice_line_key: key, invoice_id, invoice_date: piece.date, order_id, order_line: ln, slip_id: piece.slip,
            customer: c.account, invoice_account: c.invoice_account, item: p.item, uom: p.uom, qty: piece.qty, price,
            gross, discount: round2(gross - lnet), net: lnet, tax: round2(lnet * 0.14), cogs: round2(costEgp / rate), cogs_restated: round2(restated / rate),
            currency: cur, fx_rate: rate, net_mst: round2(lnet * rate), cogs_mst: costEgp,
            salesperson: rep, territory: c.territory, channel: c.channel, warehouse: wh, doc_type: "invoice", credit_class: null, return_reason: null, original_invoice_line_key: null,
          });
          const due = addDays(piece.date, c.terms_days);
          const amt = round2(lnet * rate * 1.14);
          const trans_id = `AR-${invoice_id}`;
          arTrans.push({ trans_id, customer: c.invoice_account, doc_type: "invoice", doc_id: invoice_id, trans_date: piece.date, due_date: due, amount: amt });
          // Payment behaviour: most on time, some late, some partial, a few unpaid
          const behaviour = r();
          const payDelay = behaviour < 0.55 ? c.terms_days - Math.floor(r() * 10) : behaviour < 0.85 ? c.terms_days + 5 + Math.floor(r() * 40) : behaviour < 0.95 ? c.terms_days + 60 + Math.floor(r() * 120) : 99999;
          const payDate = addDays(piece.date, payDelay);
          if (payDelay < 99999 && payDate <= DEMO_AS_OF) {
            const partial = r() < 0.06;
            const payAmt = partial ? round2(amt * 0.5) : amt;
            const pay_id = `PAY-${String(++payNo).padStart(6, "0")}`;
            arTrans.push({ trans_id: `AR-${pay_id}`, customer: c.invoice_account, doc_type: "payment", doc_id: pay_id, trans_date: payDate, due_date: payDate, amount: -payAmt });
            const reversed = r() < 0.004 ? addDays(payDate, 7) : null; // S17
            settlements.push({ settle_id: `ST-${String(++setNo).padStart(6, "0")}`, debit_trans: trans_id, credit_trans: `AR-${pay_id}`, settle_date: payDate, amount: payAmt, reversed_date: reversed && reversed <= DEMO_AS_OF ? reversed : null });
          }
          // Credits: physical return later (S07) or price-only allowance (S08)
          const rc = r();
          if (rc < 0.022 || rc > 0.992) {
            const physical = rc < 0.022;
            const cnDate = addDays(piece.date, 10 + Math.floor(r() * 45));
            if (cnDate <= DEMO_AS_OF) {
              const cn_id = `CN-${String(++cnNo).padStart(6, "0")}`;
              const rq = physical ? Math.max(1, Math.round(piece.qty * between(0.1, 0.6))) : 0;
              const cnet = physical ? round2(rq * price * (1 - disc)) : round2(lnet * 0.05);
              invoiceLines.push({
                invoice_line_key: `${cn_id}-1`, invoice_id: cn_id, invoice_date: cnDate, order_id, order_line: ln, slip_id: null,
                customer: c.account, invoice_account: c.invoice_account, item: p.item, uom: p.uom, qty: physical ? -rq : 0, price,
                gross: physical ? -round2(rq * price) : -cnet, discount: physical ? -round2(rq * price * disc) : 0, net: -cnet, tax: -round2(cnet * 0.14),
                cogs: physical ? -round2((costEgp / piece.qty) * rq / rate) : 0, cogs_restated: physical ? -round2((restated / piece.qty) * rq / rate) : 0,
                currency: cur, fx_rate: rate, net_mst: -round2(cnet * rate), cogs_mst: physical ? -round2((costEgp / piece.qty) * rq) : 0,
                salesperson: rep, territory: c.territory, channel: c.channel, warehouse: wh, doc_type: "credit",
                credit_class: physical ? "physical_return" : "commercial_credit", return_reason: physical ? pick(RETURN_REASONS) : "Price allowance",
                original_invoice_line_key: key,
              });
              arTrans.push({ trans_id: `AR-${cn_id}`, customer: c.invoice_account, doc_type: "credit", doc_id: cn_id, trans_date: cnDate, due_date: cnDate, amount: -round2(cnet * rate * 1.14) });
            }
          }
        }
      }
    }
  }
  // S18: an unallocated advance payment
  arTrans.push({ trans_id: "AR-ADV-000001", customer: customers[2].account, doc_type: "advance", doc_id: "ADV-000001", trans_date: "2026-10-20", due_date: "2026-10-20", amount: -250000 });

  // Targets: monthly per rep from the trailing pattern × 1.12, version 1 approved; Aug 2026 revised (S30).
  const targets: DemoData["targets"] = [];
  const byRepMonth = new Map<string, number>();
  for (const l of invoiceLines) { const k = `${l.salesperson}|${l.invoice_date.slice(0, 7)}`; byRepMonth.set(k, (byRepMonth.get(k) ?? 0) + l.net_mst); }
  for (const sp of salespeople) {
    for (let m = "2024-01-01"; m <= "2026-12-01"; m = addMonths(m, 1)) {
      const prev = byRepMonth.get(`${sp.code}|${addMonths(m, -12).slice(0, 7)}`) ?? byRepMonth.get(`${sp.code}|${addMonths(m, -1).slice(0, 7)}`) ?? 0;
      const amount = Math.round((prev * 1.12) / 1000) * 1000;
      if (m === "2026-08-01") {
        targets.push({ version: 1, status: "superseded", salesperson: sp.code, month: m, amount });
        targets.push({ version: 2, status: "approved", salesperson: sp.code, month: m, amount: Math.round(amount * 0.95 / 1000) * 1000 });
      } else targets.push({ version: 1, status: "approved", salesperson: sp.code, month: m, amount });
    }
  }

  return { territories, channels, warehouses, salespeople, customers, products, orderLines, slipLines, invoiceLines, arTrans, settlements, targets, fx };
}

/** Expected totals for the seed report (spec §13.3) — computed straight from the generated facts. */
export function seedReport(d: DemoData) {
  const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
  const byYear = new Map<string, number>(), byMonth = new Map<string, number>();
  for (const l of d.invoiceLines) {
    byYear.set(l.invoice_date.slice(0, 4), (byYear.get(l.invoice_date.slice(0, 4)) ?? 0) + l.net_mst);
    byMonth.set(l.invoice_date.slice(0, 7), (byMonth.get(l.invoice_date.slice(0, 7)) ?? 0) + l.net_mst);
  }
  return {
    seed: DEMO_SEED, asOf: DEMO_AS_OF,
    counts: {
      customers: d.customers.length, products: d.products.length, salespeople: d.salespeople.length,
      orders: new Set(d.orderLines.map((o) => o.order_id)).size, orderLines: d.orderLines.length, slipLines: d.slipLines.length,
      invoiceLines: d.invoiceLines.filter((l) => l.doc_type === "invoice").length, creditLines: d.invoiceLines.filter((l) => l.doc_type === "credit").length,
      arTrans: d.arTrans.length, settlements: d.settlements.length,
    },
    netSalesMst: sum(d.invoiceLines.map((l) => l.net_mst)),
    byYear: Object.fromEntries([...byYear].map(([k, v]) => [k, Math.round(v * 100) / 100])),
    byMonth: Object.fromEntries([...byMonth].sort().map(([k, v]) => [k, Math.round(v * 100) / 100])),
  };
}
