import "server-only";
import { sql } from "../db";
import type { Ctx } from "./modules";
import { documentTypes, enteredCounts, expectedEntries, EXPECTED_TYPES, invoicePayments, journalSummary, PROD_STATUS, SO_DOC, TO_STATUS, userActivity } from "./ops";
import type { CardSpec, DashSpec } from "./dashtypes";
import { salesWhere } from "./common";

/* Module dashboards (first page of every module), laid out like the sales dashboard:
   six tiles with the change vs the same period last year, then cards. Queries run one after the other. */

/* Shared queries (same as in modules.ts). */
async function vendorOpen(c: Ctx) {
  // Vendor invoices open at the as-of date (payments dated later do not count).
  return sql<{ vendor: string; name: string; invoice: string; trans_date: string; due_date: string; amount: number; paid: number; purchase_order: string }[]>`
    select t.vendor, coalesce(v.name, t.vendor) name, t.invoice, t.trans_date::text, t.due_date::text, (-t.amount)::float amount,
      coalesce((select sum(p.amount) from d365.demo_vend_trans p where p.company = t.company and p.invoice = t.invoice and p.kind = 'Payment' and p.trans_date <= ${c.asOf}), 0)::float paid,
      t.purchase_order
    from d365.demo_vend_trans t left join d365.demo_vendors v on v.company = t.company and v.vendor = t.vendor
    where t.company = ${c.company} and t.kind = 'Invoice' and t.trans_date <= ${c.asOf}`;
}
async function stockAt(c: Ctx, at: string) {
  return sql<{ item: string; name: string; item_group: string; site: string; warehouse: string; qty: number; value: number; unit_cost: number; reorder_point: number; safety_stock: number }[]>`
    select t.item, coalesce(i.name, t.item) name, coalesce(i.item_group,'') item_group, t.site, t.warehouse, sum(t.qty)::float qty, sum(t.cost_amount)::float value,
      coalesce(max(i.unit_cost),0)::float unit_cost, coalesce(max(i.reorder_point),0)::float reorder_point, coalesce(max(i.safety_stock),0)::float safety_stock
    from d365.demo_invent_trans t left join d365.demo_items i on i.company = t.company and i.item = t.item
    where t.company = ${c.company} and t.trans_date <= ${at} group by 1,2,3,4,5`;
}
async function bankRows(c: Ctx) {
  return sql<{ account: string; account_name: string; trans_date: string; kind: string; description: string; amount: number }[]>`
    select account, account_name, trans_date::text, kind, description, amount::float from d365.demo_bank_trans where company = ${c.company} order by trans_date, id`;
}
async function salesMonthly(c: Ctx) {
  return sql<{ m: string; sales: number; cost: number }[]>`
    select to_char(l.invoice_date,'YYYY-MM') m, sum(l.line_amount)::float sales, sum(l.qty * coalesce(i.unit_cost, l.price * 0.65))::float cost
    from d365.invoice_lines l left join d365.demo_items i on i.company = l.company and i.item = l.item
    where l.company = ${c.company} and l.invoice_date between ${c.from} and ${c.to} and l.currency = ${c.cur} group by 1 order by 1`;
}

const depr = (a: any, at: string) => {
  // Straight line, monthly, from the month after acquisition, until disposal or end of life.
  const end = a.disposal_date && a.disposal_date < at ? a.disposal_date : at;
  const m = Math.max(0, (Number(end.slice(0, 4)) - Number(a.acquisition_date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(a.acquisition_date.slice(5, 7)));
  return Math.min(a.cost - a.salvage, ((a.cost - a.salvage) / a.life_months) * Math.min(m, a.life_months));
};
const assetRows = (c: Ctx) => sql<any[]>`select asset, name, asset_group, location, acquisition_date::text, cost::float, life_months, salvage::float, disposal_date::text, disposal_amount::float from d365.demo_assets where company = ${c.company} order by asset`;

export interface DashDef { title: string; sub: string; demo?: boolean; run: (c: Ctx) => Promise<DashSpec> }

const months = (from: string, to: string) => {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out.slice(-24);
};
const prevM = (m: string) => { const y = +m.slice(0, 4), n = +m.slice(5, 7); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, "0")}`; };
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const group = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) =>
  [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + (Number(val(r)) || 0)), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
const prevCtx = (c: Ctx): Ctx => ({ ...c, from: c.s.prevFrom, to: c.s.prevTo, asOf: c.s.prevTo });
const inP = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to;
const dd = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const P = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ml = (m: string) => MON[+m.slice(5, 7) - 1];
const N = (x: number) => Math.round(x).toLocaleString("en-US");
const S = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0); };
const ratio = (a: number, b: number) => (b ? a / b : 0);
const BUCKETS = [{ label: "Not due", lo: -1e9, hi: 0 }, { label: "1–30", lo: 1, hi: 30 }, { label: "31–60", lo: 31, hi: 60 }, { label: "61–90", lo: 61, hi: 90 }, { label: "Over 90", lo: 91, hi: 1e9 }];
const ramp = (i: number, n: number) => (i === 0 ? "var(--c1)" : `hsl(16 72% ${70 - ((i - 1) / Math.max(1, n - 2)) * 42}%)`);
const aging = <T,>(rows: T[], days: (r: T) => number, val: (r: T) => number) =>
  BUCKETS.map((b, i) => ({ label: b.label, value: sum(rows.filter((r) => days(r) >= b.lo && days(r) <= b.hi), val), color: ramp(i, BUCKETS.length) }));
const link = (c: Ctx, path: string, r?: string) => {
  const q = new URLSearchParams({ company: c.company, from: c.from, to: c.to });
  if (r) q.set("r", r);
  return `${path}?${q}`;
};
const L = (c: Ctx, path: string, label: string, r?: string) => ({ href: link(c, path, r), label });

/* ------------------------------------------------------------------ Transactions */
const transactions: DashDef = { title: "Transactions", sub: "Posted and not posted documents per module, who entered what, and expected vs entered", run: async (c) => {
  const types = await documentTypes(c.company);
  const jr = await journalSummary(c.company);
  const ent = await enteredCounts(c.company, c.from, c.to);
  const entP = await enteredCounts(c.company, c.s.prevFrom, c.s.prevTo);
  const ua = await userActivity(c.company, c.from, c.to);
  const uaP = await userActivity(c.company, c.s.prevFrom, c.s.prevTo);
  const exp = await expectedEntries(c.company, c.from, c.to);
  const total = sum(types, (t) => t.total), posted = sum(types, (t) => t.posted), open = sum(types, (t) => t.open);
  const entered = sum([...ent.values()], (n) => n), enteredP = sum([...entP.values()], (n) => n);
  const byM = new Map<string, { a: number; b: number }>();
  for (const [k, n] of ent) { const [day, t] = k.split("|"); const m = byM.get(day.slice(0, 7)) ?? { a: 0, b: 0 }; m.a += n; if (t === "inv") m.b += n; byM.set(day.slice(0, 7), m); }
  const trend = months(c.from, c.to).map((m) => ({ m, a: byM.get(m)?.a ?? 0, b: byM.get(m)?.b ?? 0 }));
  const expRows = EXPECTED_TYPES.map((t) => {
    const rows = exp.filter((e) => e.doc_type === t.key);
    const e = sum(rows, (r) => r.expected), got = sum(rows, (r) => ent.get(`${r.day}|${r.doc_type}`) ?? 0);
    return { label: t.label, e, got };
  }).filter((r) => r.e > 0);
  const eT = sum(expRows, (r) => r.e), gT = sum(expRows, (r) => r.got);
  const userTotal = (u: (typeof ua.users)[number]) => u.so_created + u.invoices + u.po + u.journals;
  const cards: CardSpec[] = [
    { title: "Documents entered over time", link: L(c, "/ops/users", "User activity"), body: { kind: "trend", data: trend, a: "Documents", b: "Sales invoices" } },
    { title: "Posted vs not posted", link: L(c, "/ops", "Tracking"), body: { kind: "table", head: ["Document", "Posted", "Not posted", "Posted %"], rows: types.map((t) => [t.name, N(t.posted), N(t.open), P(ratio(t.posted, t.total))]) } },
    { title: "Not posted by module", link: L(c, "/ops/documents", "Documents"), body: { kind: "donut", data: group(types, (t) => t.module, (t) => t.open), centerLabel: "not posted" },
      more: [{ label: "Cancelled documents", body: { kind: "chips", items: types.filter((t) => t.cancelled).map((t) => ({ label: t.name, value: N(t.cancelled) })) } }] },
    { title: "Journals by module", body: { kind: "table", head: ["Module · journal", "Total", "Posted", "Not posted"], rows: jr.map((j) => [`${j.module} · ${j.kind}`, N(j.total), N(j.posted), N(j.total - j.posted)]) } },
    { title: "Most active users", link: L(c, "/ops/users", "All users"), stats: [{ label: "Active users", value: N(ua.users.length) }, { label: "Documents", value: N(sum(ua.users, userTotal)) }, { label: "Avg per user", value: ua.users.length ? N(sum(ua.users, userTotal) / ua.users.length) : "–" }],
      body: { kind: "bars", cols: ["User", "Days active", "Documents"], rows: ua.users.slice(0, 10).map((u) => ({ a: u.name, b: `${u.days} days`, value: userTotal(u) })) } },
    { title: "Expected vs entered", link: L(c, "/ops/expected", "Enter expected"), stats: [{ label: "Expected", value: N(eT) }, { label: "Entered", value: N(gT) }, { label: "Gap", value: N(gT - eT), tone: gT >= eT ? "good" : "bad" }],
      body: { kind: "table", head: ["Document", "Expected", "Entered", "Achieved"], rows: expRows.map((r) => [r.label, N(r.e), N(r.got), P(ratio(r.got, r.e))]) } },
  ];
  return {
    tiles: [
      { label: "Documents entered", value: entered, fmt: "int", prev: enteredP, icon: "doc", href: link(c, "/ops/users") },
      { label: "Posted", value: posted, fmt: "int", icon: "check", href: link(c, "/ops"), note: "All documents to date" },
      { label: "Not posted", value: open, fmt: "int", icon: "alert", href: link(c, "/ops/documents"), note: "Waiting to be posted" },
      { label: "Posting rate", value: ratio(posted, total), fmt: "pct", icon: "pie", note: "Posted ÷ all documents" },
      { label: "Unposted journals", value: sum(jr, (j) => j.total - j.posted), fmt: "int", icon: "clock", href: link(c, "/ops") },
      { label: "Active users", value: ua.users.length, fmt: "int", prev: uaP.users.length, icon: "users", href: link(c, "/ops/users") },
    ],
    cards,
    strip: [{ label: "Document types tracked", value: N(types.length) }, { label: "Documents (all time)", value: N(total) }, { label: "Journals", value: N(sum(jr, (j) => j.total)) }, { label: "Days with expectations", value: N(new Set(exp.map((e) => e.day)).size) }],
  };
} };

/* ------------------------------------------------------------------ Receivables */
const receivables: DashDef = { title: "Receivables & collections", sub: "Customer balances, overdue invoices, credit and collections", run: async (c) => {
  const pc = prevCtx(c);
  const inv = await invoicePayments({ ...c.s, from: "1900-01-01", to: c.asOf }, c.asOf);
  const open = inv.filter((r) => r.status !== "Paid");
  const over = open.filter((r) => (r.days_overdue ?? 0) > 0);
  const collQ = (x: Ctx) => sql<{ m: string; mode: string; v: number }[]>`select to_char(trans_date,'YYYY-MM') m, coalesce(nullif(paym_mode,''),'Not set') mode, (-sum(amount_mst))::float v
    from d365.cust_trans where company = ${x.company} and trans_type = 15 and trans_date between ${x.from} and ${x.to} group by 1,2`;
  const coll = await collQ(c), collP = await collQ(pc);
  const sm = await salesMonthly(c), smP = await salesMonthly(pc);
  const grp = await sql<{ label: string; value: number }[]>`select coalesce('Group ' || nullif(c.cust_group,''),'No group') label, sum(t.amount_mst - t.settle_mst)::float value
    from d365.cust_trans t left join d365.customers c on c.company = t.company and c.account = t.account
    where t.company = ${c.company} and t.trans_date <= ${c.asOf} and (t.closed is null or t.closed > ${c.asOf}) group by 1 order by 2 desc`;
  const bal = sum(open, (r) => r.remaining), sales = sum(sm, (r) => r.sales), salesP = sum(smP, (r) => r.sales);
  const cT = sum(coll, (r) => r.v), cTP = sum(collP, (r) => r.v);
  const periodDays = Math.max(1, dd(c.to, c.from) + 1);
  const paid = inv.filter((r) => r.status === "Paid" && inP(r.last_settle ?? r.closed, c.from, c.to) && r.days_to_pay !== null);
  return {
    tiles: [
      { label: "Customer balance", value: bal, fmt: "money", icon: "money", href: link(c, "/m/receivables", "balances") },
      { label: "Overdue", value: sum(over, (r) => r.remaining), fmt: "money", icon: "alert", href: link(c, "/m/receivables", "overdue") },
      { label: "Over 90 days", value: sum(over.filter((r) => (r.days_overdue ?? 0) > 90), (r) => r.remaining), fmt: "money", icon: "clock" },
      { label: "DSO", value: sales ? (bal / sales) * periodDays : 0, fmt: "days", icon: "tag" },
      { label: "Collected", value: cT, fmt: "money", prev: cTP, icon: "bank", href: link(c, "/m/receivables", "payments") },
      { label: "Collected ÷ sales", value: ratio(cT, sales), fmt: "pct", prev: salesP ? cTP / salesP : null, icon: "pie" },
    ],
    cards: [
      { title: "Balance by days overdue", link: L(c, "/sales/aging", "Aging"), body: { kind: "bucket", money: true, data: aging(open, (r) => r.days_overdue ?? 0, (r) => r.remaining) } },
      { title: "Sales vs collections", body: { kind: "pair", money: true, data: months(c.from, c.to).map((m) => ({ label: ml(m), sales: sm.find((x) => x.m === m)?.sales ?? 0, coll: sum(coll.filter((x) => x.m === m), (x) => x.v) })), a: { key: "sales", name: "Sales" }, b: { key: "coll", name: "Collected" } } },
      { title: "Top overdue customers", link: L(c, "/m/receivables", "Overdue invoices", "overdue"), body: { kind: "bars", cols: ["Customer", "Invoices", "Overdue"], rows: group(over, (r) => r.name, (r) => r.remaining).slice(0, 10).map((g) => ({ a: g.label, b: `${over.filter((r) => r.name === g.label).length} inv.`, value: g.value })) } },
      { title: "Balance by customer group", body: { kind: "donut", money: true, data: grp, centerLabel: `Balance (${c.cur})` } },
      { title: "Collections by payment method", stats: [{ label: "Payments", value: N(new Set(coll.map((x) => x.m + x.mode)).size ? sum(coll, () => 1) : 0) }, { label: "Avg days to pay", value: paid.length ? `${(sum(paid, (r) => r.days_to_pay ?? 0) / paid.length).toFixed(0)} d` : "–" }, { label: "Paid late", value: P(ratio(paid.filter((r) => (r.late_days ?? 0) > 0).length, paid.length)) }],
        body: { kind: "donut", money: true, data: group(coll, (x) => x.mode, (x) => x.v), centerLabel: `Collected (${c.cur})` } },
      { title: "Largest overdue invoices", link: L(c, "/sales/payments", "Payment status"), body: { kind: "table", head: ["Customer", "Due", "Days", "Remaining"], rows: [...over].sort((a, b) => b.remaining - a.remaining).slice(0, 10).map((r) => [r.name, r.due_date, N(r.days_overdue ?? 0), S(r.remaining)]) } },
    ],
    strip: [{ label: "Open invoices", value: N(open.length) }, { label: "Overdue invoices", value: N(over.length) }, { label: "Customers with balance", value: N(new Set(open.map((r) => r.account)).size) }, { label: "Invoices (all time)", value: N(inv.length) }],
  };
} };

/* ------------------------------------------------------------------ Purchasing (demo) */
const purchLines = (c: Ctx) => sql<{ purchase_order: string; vendor_name: string; item_name: string; item_group: string; qty: number; received_qty: number; price: number; order_date: string; delivery_date: string; received_date: string | null; warehouse: string; buyer: string }[]>`
  select l.purchase_order, coalesce(v.name, l.vendor) vendor_name, coalesce(i.name, l.item) item_name, coalesce(nullif(i.item_group,''),'No group') item_group,
    l.qty::float, l.received_qty::float, l.price::float, l.order_date::text, l.delivery_date::text, l.received_date::text, coalesce(l.warehouse,'') warehouse, coalesce(nullif(l.buyer,''),'Not set') buyer
  from d365.demo_purch_lines l left join d365.demo_vendors v on v.company = l.company and v.vendor = l.vendor left join d365.demo_items i on i.company = l.company and i.item = l.item
  where l.company = ${c.company}`;
type PL = Awaited<ReturnType<typeof purchLines>>[number];
const purchasing: DashDef = { title: "Purchasing", sub: "Purchase orders, vendors, prices, delivery performance and pending receipts", demo: true, run: async (c) => {
  const all = await purchLines(c);
  const cur = all.filter((r) => inP(r.order_date, c.from, c.to)), prev = all.filter((r) => inP(r.order_date, c.s.prevFrom, c.s.prevTo));
  const val = (r: (typeof all)[number]) => r.qty * r.price;
  const openL = all.filter((r) => r.order_date <= c.asOf && r.received_qty < r.qty).map((r) => ({ ...r, rem: r.qty - r.received_qty, value: (r.qty - r.received_qty) * r.price }));
  const rec = (rows: PL[]) => rows.filter((r) => r.received_date);
  const onTime = (rows: PL[]) => ratio(rec(rows).filter((r) => r.received_date! <= r.delivery_date).length, rec(rows).length);
  const recCur = rec(all.filter((r) => inP(r.received_date, c.from, c.to)));
  const late = recCur.filter((r) => r.received_date! > r.delivery_date);
  const pos = (rows: PL[]) => new Set(rows.map((r) => r.purchase_order)).size;
  return {
    tiles: [
      { label: "Purchases", value: sum(cur, val), fmt: "money", prev: sum(prev, val), icon: "cart", href: link(c, "/m/purchasing", "register") },
      { label: "Purchase orders", value: pos(cur), fmt: "int", prev: pos(prev), icon: "doc" },
      { label: "Active vendors", value: new Set(cur.map((r) => r.vendor_name)).size, fmt: "int", prev: new Set(prev.map((r) => r.vendor_name)).size, icon: "users" },
      { label: "Avg order value", value: ratio(sum(cur, val), pos(cur)), fmt: "money", prev: ratio(sum(prev, val), pos(prev)), icon: "tag" },
      { label: "Open PO value", value: sum(openL, (r) => r.value), fmt: "money", icon: "clock", href: link(c, "/m/purchasing", "open") },
      { label: "On-time delivery", value: onTime(recCur), fmt: "pct", prev: onTime(rec(all.filter((r) => inP(r.received_date, c.s.prevFrom, c.s.prevTo)))) || null, icon: "truck", href: link(c, "/m/purchasing", "delivery") },
    ],
    cards: [
      { title: "Purchases over time", body: { kind: "trend", money: true, data: months(c.from, c.to).map((m) => { const r = cur.filter((x) => x.order_date.startsWith(m)); return { m, a: sum(r, val), b: pos(r) }; }), a: "Purchases", b: "Orders" } },
      { title: "Purchases by item group", body: { kind: "donut", money: true, data: group(cur, (r) => r.item_group, val), centerLabel: `Purchases (${c.cur})` } },
      { title: "Top 10 vendors", link: L(c, "/m/payables", "Vendor aging", "aging"), body: { kind: "bars", cols: ["Vendor", "Orders", `Purchases (${c.cur})`], rows: group(cur, (r) => r.vendor_name, val).slice(0, 10).map((g) => ({ a: g.label, b: `${pos(cur.filter((r) => r.vendor_name === g.label))} POs`, value: g.value })) } },
      { title: "Top 10 items purchased", link: L(c, "/m/purchasing", "Price history", "price"), body: { kind: "bars", cols: ["Item", "Group", `Purchases (${c.cur})`], rows: group(cur, (r) => r.item_name, val).slice(0, 10).map((g) => ({ a: g.label, b: cur.find((r) => r.item_name === g.label)?.item_group, value: g.value })) } },
      { title: "Delivery performance", link: L(c, "/m/purchasing", "Per vendor", "delivery"),
        stats: [{ label: "Receipts", value: N(recCur.length) }, { label: "On time", value: P(onTime(recCur)), tone: "good" }, { label: "Late", value: N(late.length), tone: late.length ? "bad" : undefined }, { label: "Avg days late", value: late.length ? (sum(late, (r) => dd(r.received_date!, r.delivery_date)) / late.length).toFixed(1) : "0" }],
        body: { kind: "rank", data: group(late, (r) => r.vendor_name, () => 1).slice(0, 8) }, more: [{ label: "Purchases by buyer", body: { kind: "chips", items: group(cur, (r) => r.buyer, val).map((g) => ({ label: g.label, value: S(g.value) })) } }] },
      { title: "Pending receipts", link: L(c, "/m/purchasing", "All pending", "receipts"), stats: [{ label: "Open lines", value: N(openL.length) }, { label: "Open orders", value: N(new Set(openL.map((r) => r.purchase_order)).size) }, { label: "Overdue lines", value: N(openL.filter((r) => r.delivery_date < c.asOf).length), tone: "bad" }],
        body: { kind: "table", head: ["Vendor", "Expected", "Qty", "Value"], rows: [...openL].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date)).slice(0, 10).map((r) => [r.vendor_name, r.delivery_date, N(r.rem), S(r.value)]) } },
    ],
    strip: [{ label: "Purchase lines", value: N(cur.length) }, { label: "Items purchased", value: N(new Set(cur.map((r) => r.item_name)).size) }, { label: "Warehouses", value: N(new Set(cur.map((r) => r.warehouse)).size) }, { label: "Open PO lines", value: N(openL.length) }],
  };
} };

/* ------------------------------------------------------------------ Payables (demo) */
const payables: DashDef = { title: "Payables", sub: "Vendor balances, aging, payments due and payments made", demo: true, run: async (c) => {
  const ap = (await vendorOpen(c)).map((r) => ({ ...r, open: r.amount - r.paid, od: dd(c.asOf, r.due_date) })).filter((r) => r.open > 0.005);
  const tr = await sql<{ kind: string; trans_date: string; amount: number; paym_mode: string; vendor: string }[]>`
    select kind, trans_date::text, amount::float, coalesce(nullif(paym_mode,''),'Not set') paym_mode, vendor from d365.demo_vend_trans where company = ${c.company}`;
  const inv = (f: string, t: string) => sum(tr.filter((r) => r.kind === "Invoice" && inP(r.trans_date, f, t)), (r) => -r.amount);
  const pay = (f: string, t: string) => tr.filter((r) => r.kind === "Payment" && inP(r.trans_date, f, t));
  const over = ap.filter((r) => r.od > 0);
  const W = [{ label: "Overdue", f: (d: number) => d < 0 }, { label: "This week", f: (d: number) => d >= 0 && d <= 7 }, { label: "8–14 d", f: (d: number) => d > 7 && d <= 14 }, { label: "15–30 d", f: (d: number) => d > 14 && d <= 30 }, { label: "Later", f: (d: number) => d > 30 }];
  const pc = pay(c.from, c.to);
  return {
    tiles: [
      { label: "Open payables", value: sum(ap, (r) => r.open), fmt: "money", icon: "money", href: link(c, "/m/payables", "aging") },
      { label: "Overdue", value: sum(over, (r) => r.open), fmt: "money", icon: "alert", href: link(c, "/m/payables", "due") },
      { label: "Due next 30 days", value: sum(ap.filter((r) => r.od <= 0 && r.od >= -30), (r) => r.open), fmt: "money", icon: "clock", href: link(c, "/m/payables", "due") },
      { label: "Invoiced", value: inv(c.from, c.to), fmt: "money", prev: inv(c.s.prevFrom, c.s.prevTo), icon: "doc" },
      { label: "Paid", value: sum(pc, (r) => r.amount), fmt: "money", prev: sum(pay(c.s.prevFrom, c.s.prevTo), (r) => r.amount), icon: "bank", href: link(c, "/m/payables", "payments") },
      { label: "Vendors with balance", value: new Set(ap.map((r) => r.vendor)).size, fmt: "int", icon: "users" },
    ],
    cards: [
      { title: "Payables by days overdue", link: L(c, "/m/payables", "Vendor aging", "aging"), body: { kind: "bucket", money: true, data: aging(ap, (r) => r.od, (r) => r.open) } },
      { title: "Invoiced vs paid", body: { kind: "pair", money: true, data: months(c.from, c.to).map((m) => ({ label: ml(m), inv: sum(tr.filter((r) => r.kind === "Invoice" && r.trans_date.startsWith(m)), (r) => -r.amount), paid: sum(tr.filter((r) => r.kind === "Payment" && r.trans_date.startsWith(m)), (r) => r.amount) })), a: { key: "inv", name: "Invoiced" }, b: { key: "paid", name: "Paid" } } },
      { title: "Top vendors by balance", link: L(c, "/m/payables", "Statements", "statement"), body: { kind: "bars", cols: ["Vendor", "Invoices", `Balance (${c.cur})`], rows: group(ap, (r) => r.name, (r) => r.open).slice(0, 10).map((g) => ({ a: g.label, b: `${ap.filter((r) => r.name === g.label).length} open`, value: g.value })) } },
      { title: "Due by week", link: L(c, "/m/payables", "Payments due", "due"), body: { kind: "bucket", money: true, data: W.map((w, i) => ({ label: w.label, value: sum(ap.filter((r) => w.f(-r.od)), (r) => r.open), color: i === 0 ? "hsl(16 72% 45%)" : "var(--c1)" })) } },
      { title: "Payments by method", stats: [{ label: "Payments", value: N(pc.length) }, { label: "Vendors paid", value: N(new Set(pc.map((r) => r.vendor)).size) }, { label: "Avg payment", value: pc.length ? S(sum(pc, (r) => r.amount) / pc.length) : "–" }],
        body: { kind: "donut", money: true, data: group(pc, (r) => r.paym_mode, (r) => r.amount), centerLabel: `Paid (${c.cur})` } },
      { title: "Largest overdue invoices", body: { kind: "table", head: ["Vendor", "Due", "Days", "Open"], rows: [...over].sort((a, b) => b.open - a.open).slice(0, 10).map((r) => [r.name, r.due_date, N(r.od), S(r.open)]) } },
    ],
    strip: [{ label: "Open invoices", value: N(ap.length) }, { label: "Overdue invoices", value: N(over.length) }, { label: "Vendor invoices in period", value: N(tr.filter((r) => r.kind === "Invoice" && inP(r.trans_date, c.from, c.to)).length) }, { label: "Payments in period", value: N(pc.length) }],
  };
} };

/* ------------------------------------------------------------------ Inventory (demo) */
const inventory: DashDef = { title: "Inventory", sub: "Stock value, movement, slow movers, reorder and batch expiry", demo: true, run: async (c) => {
  const st = (await stockAt(c, c.asOf)).filter((r) => r.qty > 0.0001);
  const stP = (await stockAt(c, c.s.prevTo)).filter((r) => r.qty > 0.0001);
  const mv = await sql<{ m: string; i: number; o: number; ip: number; op: number }[]>`
    select to_char(trans_date,'YYYY-MM') m, coalesce(sum(cost_amount) filter (where qty > 0),0)::float i, coalesce(-sum(cost_amount) filter (where qty < 0),0)::float o, 0::float ip, 0::float op
    from d365.demo_invent_trans where company = ${c.company} and trans_date between ${c.s.prevFrom} and ${c.to} group by 1 order by 1`;
  const last = await sql<{ item: string; last: string | null }[]>`select item, max(trans_date) filter (where qty < 0)::text last from d365.demo_invent_trans where company = ${c.company} and trans_date <= ${c.asOf} group by 1`;
  const bat = await sql<{ name: string; batch: string; expiry: string; qty: number; value: number }[]>`
    select coalesce(i.name, t.item) name, t.batch, t.expiry::text, sum(t.qty)::float qty, sum(t.cost_amount)::float value
    from d365.demo_invent_trans t left join d365.demo_items i on i.company = t.company and i.item = t.item
    where t.company = ${c.company} and t.expiry is not null and t.trans_date <= ${c.asOf} group by 1,2,3 having sum(t.qty) > 0.0001 order by 3 limit 10`;
  const inC = mv.filter((r) => inP(r.m + "-01", c.from.slice(0, 7) + "-01", c.to)), inPv = mv.filter((r) => inP(r.m + "-01", c.s.prevFrom.slice(0, 7) + "-01", c.s.prevTo));
  const items = group(st, (r) => r.item, (r) => r.qty);
  const byItem = new Map<string, { name: string; group: string; qty: number; value: number; rp: number }>();
  for (const r of st) { const x = byItem.get(r.item) ?? { name: r.name, group: r.item_group || "No group", qty: 0, value: 0, rp: r.reorder_point }; x.qty += r.qty; x.value += r.value; byItem.set(r.item, x); }
  const below = [...byItem.values()].filter((x) => x.rp > 0 && x.qty <= x.rp);
  const lastMap = new Map(last.map((l) => [l.item, l.last]));
  const bands = ["0–30 d", "31–90 d", "91–180 d", "Over 180 d", "Never issued"];
  const band = (item: string) => { const l = lastMap.get(item); if (!l) return 4; const d = dd(c.asOf, l); return d <= 30 ? 0 : d <= 90 ? 1 : d <= 180 ? 2 : 3; };
  const value = sum(st, (r) => r.value);
  return {
    tiles: [
      { label: "Stock value", value, fmt: "money", prev: sum(stP, (r) => r.value) || null, icon: "box", href: link(c, "/m/inventory", "valuation") },
      { label: "Items in stock", value: items.length, fmt: "int", prev: new Set(stP.map((r) => r.item)).size || null, icon: "tag", href: link(c, "/m/inventory", "onhand") },
      { label: "Units on hand", value: sum(st, (r) => r.qty), fmt: "int", prev: sum(stP, (r) => r.qty) || null, icon: "cart" },
      { label: "Receipts (cost)", value: sum(inC, (r) => r.i), fmt: "money", prev: sum(inPv, (r) => r.i), icon: "truck", href: link(c, "/m/inventory", "movement") },
      { label: "Issues (cost)", value: sum(inC, (r) => r.o), fmt: "money", prev: sum(inPv, (r) => r.o), icon: "ret", href: link(c, "/m/inventory", "turnover") },
      { label: "Below reorder point", value: below.length, fmt: "int", icon: "alert", href: link(c, "/m/inventory", "reorder") },
    ],
    cards: [
      { title: "Receipts vs issues (cost)", link: L(c, "/m/inventory", "Item movement", "movement"), body: { kind: "pair", money: true, data: months(c.from, c.to).map((m) => ({ label: ml(m), i: mv.find((r) => r.m === m)?.i ?? 0, o: mv.find((r) => r.m === m)?.o ?? 0 })), a: { key: "o", name: "Issued" }, b: { key: "i", name: "Received" } } },
      { title: "Stock value by item group", link: L(c, "/m/inventory", "Valuation", "valuation"), body: { kind: "donut", money: true, data: group([...byItem.values()], (x) => x.group, (x) => x.value), centerLabel: `Stock value (${c.cur})` } },
      { title: "Stock value by warehouse", link: L(c, "/m/inventory", "On-hand", "onhand"), body: { kind: "rank", money: true, data: group(st, (r) => `${r.site} / ${r.warehouse}`, (r) => r.value).slice(0, 10) } },
      { title: "Top 10 items by value", body: { kind: "bars", cols: ["Item", "Group", `Value (${c.cur})`], rows: [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 10).map((x) => ({ a: x.name, b: x.group, value: x.value })) } },
      { title: "Slow-moving stock", link: L(c, "/m/inventory", "Slow & dead stock", "slow"), body: { kind: "bucket", money: true, data: bands.map((b, i) => ({ label: b, value: sum([...byItem].filter(([k]) => band(k) === i), ([, x]) => x.value), color: ramp(i, bands.length) })) } },
      { title: "Batches by expiry", link: L(c, "/m/inventory", "Batch & expiry", "batch"),
        stats: [{ label: "Expired", value: N(bat.filter((b) => b.expiry < c.asOf).length), tone: "bad" }, { label: "Within 90 days", value: N(bat.filter((b) => b.expiry >= c.asOf && dd(b.expiry, c.asOf) <= 90).length) }, { label: "Below reorder", value: N(below.length), tone: below.length ? "bad" : "good" }],
        body: { kind: "table", head: ["Item", "Batch", "Expiry", "Qty"], rows: bat.map((b) => [b.name, b.batch, b.expiry, N(b.qty)]) } },
    ],
    strip: [{ label: "Warehouses", value: N(new Set(st.map((r) => r.warehouse)).size) }, { label: "Sites", value: N(new Set(st.map((r) => r.site)).size) }, { label: "Item groups", value: N(new Set(st.map((r) => r.item_group)).size) }, { label: "Avg value per item", value: items.length ? S(value / items.length) : "–" }],
  };
} };

/* ------------------------------------------------------------------ Warehouse */
const warehouse: DashDef = { title: "Warehouse", sub: "Orders to pick and ship, receipts and transfers", demo: true, run: async (c) => {
  const so = await sql<{ sales_order: string; created: string; doc_status: number; name: string; requested_ship: string | null }[]>`
    select o.sales_order, o.created_at::date::text created, coalesce(o.doc_status,0) doc_status, coalesce(c.name, o.customer) name, o.requested_ship::text
    from d365.sales_orders o left join d365.customers c on c.company = o.company and c.account = o.customer where o.company = ${c.company} and o.status = 1`;
  const all = await purchLines(c);
  const rc = all.filter((r) => inP(r.received_date, c.from, c.to)), rp = all.filter((r) => inP(r.received_date, c.s.prevFrom, c.s.prevTo));
  const val = (r: (typeof all)[number]) => r.received_qty * r.price;
  const to = await sql<{ transfer_order: string; status: number; from_wh: string; to_wh: string; ship_date: string | null }[]>`select transfer_order, status, from_wh, to_wh, ship_date::text from d365.transfer_orders where company = ${c.company}`;
  const late = so.filter((r) => r.requested_ship && r.requested_ship < c.asOf).map((r) => ({ ...r, late: dd(c.asOf, r.requested_ship!) })).sort((a, b) => b.late - a.late);
  const transit = to.filter((t) => t.status === 1);
  return {
    tiles: [
      { label: "Orders to ship", value: so.length, fmt: "int", icon: "truck", href: link(c, "/m/warehouse", "shipments") },
      { label: "Late to ship", value: late.length, fmt: "int", icon: "alert", href: link(c, "/m/warehouse", "shipments") },
      { label: "Receipt lines", value: rc.length, fmt: "int", prev: rp.length, icon: "box", href: link(c, "/m/warehouse", "receipts") },
      { label: "Received value", value: sum(rc, val), fmt: "money", prev: sum(rp, val), icon: "money", href: link(c, "/m/warehouse", "receipts") },
      { label: "Transfers in transit", value: transit.length, fmt: "int", icon: "clock", href: link(c, "/m/warehouse", "transit") },
      { label: "Transfers not shipped", value: to.filter((t) => t.status === 0).length, fmt: "int", icon: "doc" },
    ],
    cards: [
      { title: "Orders to ship by step", link: L(c, "/m/warehouse", "Open shipments", "shipments"), body: { kind: "donut", data: group(so, (r) => SO_DOC[r.doc_status] ?? String(r.doc_status), () => 1), centerLabel: "open orders" } },
      { title: "Receipts over time", body: { kind: "trend", money: true, data: months(c.from, c.to).map((m) => { const r = rc.filter((x) => x.received_date!.startsWith(m)); return { m, a: sum(r, val), b: r.length }; }), a: "Received value", b: "Lines" } },
      { title: "Received value by warehouse", link: L(c, "/m/warehouse", "Receipts", "receipts"), body: { kind: "rank", money: true, data: group(rc, (r) => r.warehouse || "Not set", val).slice(0, 10) } },
      { title: "Transfers by status", link: L(c, "/m/warehouse", "In transit", "transit"), body: { kind: "donut", data: group(to, (t) => TO_STATUS[t.status] ?? String(t.status), () => 1), centerLabel: "transfer orders" },
        more: [{ label: "Transfers by route", body: { kind: "chips", items: group(to, (t) => `${t.from_wh} → ${t.to_wh}`, () => 1).slice(0, 8).map((g) => ({ label: g.label, value: N(g.value) })) } }] },
      { title: "Late orders to ship", body: { kind: "table", head: ["Customer", "Order", "Requested", "Days late"], rows: late.slice(0, 10).map((r) => [r.name, r.sales_order, r.requested_ship!, N(r.late)]) } },
      { title: "Transfers in transit", body: { kind: "table", head: ["Transfer", "Route", "Shipped", "Days"], rows: transit.slice(0, 10).map((t) => [t.transfer_order, `${t.from_wh} → ${t.to_wh}`, t.ship_date ?? "–", t.ship_date ? N(dd(c.asOf, t.ship_date)) : "–"]) } },
    ],
    strip: [{ label: "Vendors received from", value: N(new Set(rc.map((r) => r.vendor_name)).size) }, { label: "Items received", value: N(new Set(rc.map((r) => r.item_name)).size) }, { label: "Transfer orders", value: N(to.length) }, { label: "Customers waiting", value: N(new Set(so.map((r) => r.name)).size) }],
    note: "Orders to ship and transfers come from D365; receipts use the demo purchase lines.",
  };
} };

/* ------------------------------------------------------------------ Production */
const production: DashDef = { title: "Production", sub: "Order status, output, material use and late orders", demo: true, run: async (c) => {
  const rows = await sql<{ prod_order: string; item: string; status: number; qty: number; delivery_date: string | null; warehouse: string; qty_done: number; plan: number; actual: number; finished: string | null }[]>`
    select p.prod_order, p.item, p.status, p.qty::float, p.delivery_date::text, coalesce(nullif(p.warehouse,''),'Not set') warehouse,
      coalesce(o.qty_done,0)::float qty_done, coalesce(o.material_plan,0)::float plan, coalesce(o.material_actual,0)::float actual, o.finished_date::text finished
    from d365.prod_orders p left join d365.demo_prod_output o on o.company = p.company and o.prod_order = p.prod_order where p.company = ${c.company}`;
  const fin = rows.filter((r) => inP(r.finished, c.from, c.to)), finP = rows.filter((r) => inP(r.finished, c.s.prevFrom, c.s.prevTo));
  const openO = rows.filter((r) => r.status < 5);
  const late = openO.filter((r) => r.delivery_date && r.delivery_date < c.asOf).map((r) => ({ ...r, late: dd(c.asOf, r.delivery_date!) })).sort((a, b) => b.late - a.late);
  const varPct = (x: { plan: number; actual: number }[]) => ratio(sum(x, (r) => r.actual - r.plan), sum(x, (r) => r.plan));
  const byItem = group(fin, (r) => r.item, (r) => r.qty_done).slice(0, 8).map((g) => ({ label: g.label, plan: sum(fin.filter((r) => r.item === g.label), (r) => r.qty), done: g.value }));
  return {
    tiles: [
      { label: "Production orders", value: rows.length, fmt: "int", icon: "factory", href: link(c, "/m/production", "status") },
      { label: "Open orders", value: openO.length, fmt: "int", icon: "clock", href: link(c, "/m/production", "status") },
      { label: "Finished orders", value: fin.length, fmt: "int", prev: finP.length, icon: "check", href: link(c, "/m/production", "output") },
      { label: "Qty produced", value: sum(fin, (r) => r.qty_done), fmt: "int", prev: sum(finP, (r) => r.qty_done), icon: "box", href: link(c, "/m/production", "output") },
      { label: "Late orders", value: late.length, fmt: "int", icon: "alert", href: link(c, "/m/production", "late") },
      { label: "Material variance", value: varPct(fin), fmt: "pct", prev: finP.length ? varPct(finP) : null, icon: "pie", href: link(c, "/m/production", "material") },
    ],
    cards: [
      { title: "Orders by status", link: L(c, "/m/production", "Order status", "status"), body: { kind: "donut", data: group(rows, (r) => PROD_STATUS[r.status] ?? String(r.status), () => 1), centerLabel: "orders" } },
      { title: "Output over time", body: { kind: "trend", data: months(c.from, c.to).map((m) => { const r = fin.filter((x) => x.finished!.startsWith(m)); return { m, a: sum(r, (x) => x.qty_done), b: r.length }; }), a: "Qty produced", b: "Orders finished" } },
      { title: "Planned vs produced by item", link: L(c, "/m/production", "Output vs plan", "output"), body: { kind: "pair", data: byItem, a: { key: "plan", name: "Planned" }, b: { key: "done", name: "Produced" } } },
      { title: "Orders by warehouse", body: { kind: "rank", data: group(rows, (r) => r.warehouse, () => 1).slice(0, 10) } },
      { title: "Material use vs BOM", link: L(c, "/m/production", "Consumption", "material"),
        stats: [{ label: "BOM standard", value: S(sum(fin, (r) => r.plan)) }, { label: "Actual", value: S(sum(fin, (r) => r.actual)) }, { label: "Variance", value: P(varPct(fin)), tone: varPct(fin) > 0 ? "bad" : "good" }],
        body: { kind: "bars", cols: ["Item", "Orders", "Over standard"], rows: group(fin.filter((r) => r.actual > r.plan), (r) => r.item, (r) => r.actual - r.plan).slice(0, 8).map((g) => ({ a: g.label, b: `${fin.filter((r) => r.item === g.label).length} orders`, value: g.value })) } },
      { title: "Late production orders", link: L(c, "/m/production", "All late", "late"), body: { kind: "table", head: ["Order", "Item", "Due", "Days late"], rows: late.slice(0, 10).map((r) => [r.prod_order, r.item, r.delivery_date!, N(r.late)]) } },
    ],
    strip: [{ label: "Items produced", value: N(new Set(fin.map((r) => r.item)).size) }, { label: "Scheduled qty (open)", value: N(sum(openO, (r) => r.qty)) }, { label: "Yield (produced ÷ planned)", value: P(ratio(sum(fin, (r) => r.qty_done), sum(fin, (r) => r.qty))) }, { label: "Warehouses", value: N(new Set(rows.map((r) => r.warehouse)).size) }],
    note: "Order status comes from D365; output and material use are demo figures.",
  };
} };

/* ------------------------------------------------------------------ Cash & bank (demo) */
const cash: DashDef = { title: "Cash & bank", sub: "Bank balances, receipts, payments and largest movements", demo: true, run: async (c) => {
  const bt = [...(await bankRows(c))];
  const balAt = (d: string) => sum(bt.filter((b) => b.trans_date <= d), (b) => b.amount);
  const per = (f: string, t: string) => bt.filter((b) => inP(b.trans_date, f, t));
  const cur = per(c.from, c.to), prev = per(c.s.prevFrom, c.s.prevTo);
  const rin = (x: typeof bt) => sum(x.filter((b) => b.amount > 0), (b) => b.amount), rout = (x: typeof bt) => sum(x.filter((b) => b.amount < 0), (b) => -b.amount);
  const ms = months(c.from, c.to);
  return {
    tiles: [
      { label: "Cash & bank balance", value: balAt(c.asOf), fmt: "money", prev: balAt(c.s.prevTo) || null, icon: "bank", href: link(c, "/m/cash", "balances") },
      { label: "Receipts", value: rin(cur), fmt: "money", prev: rin(prev), icon: "money", href: link(c, "/m/cash", "transactions") },
      { label: "Payments", value: rout(cur), fmt: "money", prev: rout(prev), icon: "ret", href: link(c, "/m/cash", "transactions") },
      { label: "Net cash flow", value: rin(cur) - rout(cur), fmt: "money", prev: prev.length ? rin(prev) - rout(prev) : null, icon: "profit" },
      { label: "Bank accounts", value: new Set(bt.map((b) => b.account)).size, fmt: "int", icon: "doc" },
      { label: "Transactions", value: cur.length, fmt: "int", prev: prev.length, icon: "tag", href: link(c, "/m/cash", "forecast") },
    ],
    cards: [
      { title: "Month-end balance", link: L(c, "/m/cash", "Balances", "balances"), body: { kind: "trend", money: true, data: ms.map((m) => ({ m, a: balAt(`${m}-31`), b: cur.filter((b) => b.trans_date.startsWith(m)).length })), a: "Balance", b: "Transactions" } },
      { title: "Receipts vs payments", body: { kind: "pair", money: true, data: ms.map((m) => { const x = cur.filter((b) => b.trans_date.startsWith(m)); return { label: ml(m), out: rout(x), in: rin(x) }; }), a: { key: "out", name: "Payments" }, b: { key: "in", name: "Receipts" } } },
      { title: "Balance by account", body: { kind: "donut", money: true, data: group(bt.filter((b) => b.trans_date <= c.asOf), (b) => b.account_name || b.account, (b) => b.amount), centerLabel: `Balance (${c.cur})` } },
      { title: "Receipts by type", body: { kind: "donut", money: true, data: group(cur.filter((b) => b.amount > 0), (b) => b.kind, (b) => b.amount), centerLabel: `Receipts (${c.cur})` } },
      { title: "Payments by type", link: L(c, "/m/cash", "Cash forecast", "forecast"), body: { kind: "donut", money: true, data: group(cur.filter((b) => b.amount < 0), (b) => b.kind, (b) => -b.amount), centerLabel: `Payments (${c.cur})` } },
      { title: "Largest movements", link: L(c, "/m/cash", "All transactions", "transactions"), body: { kind: "table", head: ["Description", "Date", "Account", "Amount"], rows: [...cur].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 10).map((b) => [b.description || b.kind, b.trans_date, b.account, S(b.amount)]) } },
    ],
  };
} };

/* ------------------------------------------------------------------ Fixed assets (demo) */
const assets: DashDef = { title: "Fixed assets", sub: "Asset base, book value, depreciation, additions and disposals", demo: true, run: async (c) => {
  const all = await assetRows(c);
  const liveAt = (d: string) => all.filter((a) => a.acquisition_date <= d && (!a.disposal_date || a.disposal_date > d));
  const live = liveAt(c.asOf), liveP = liveAt(c.s.prevTo);
  const nbv = (a: any, d: string) => a.cost - depr(a, d);
  const dayBefore = (d: string) => new Date(Date.parse(d) - 86400000).toISOString().slice(0, 10);
  const deprIn = (f: string, t: string) => sum(all, (a) => depr(a, t) - depr(a, dayBefore(f)));
  const adds = (f: string, t: string) => all.filter((a) => inP(a.acquisition_date, f, t));
  const disp = all.filter((a) => inP(a.disposal_date, c.from, c.to));
  const byGroup = group(live, (a) => a.asset_group || "No group", (a) => nbv(a, c.asOf));
  return {
    tiles: [
      { label: "Active assets", value: live.length, fmt: "int", prev: liveP.length || null, icon: "factory", href: link(c, "/m/assets", "register") },
      { label: "Acquisition cost", value: sum(live, (a) => a.cost), fmt: "money", prev: sum(liveP, (a) => a.cost) || null, icon: "money" },
      { label: "Acc. depreciation", value: sum(live, (a) => depr(a, c.asOf)), fmt: "money", prev: sum(liveP, (a) => depr(a, c.s.prevTo)) || null, icon: "ret" },
      { label: "Net book value", value: sum(live, (a) => nbv(a, c.asOf)), fmt: "money", prev: sum(liveP, (a) => nbv(a, c.s.prevTo)) || null, icon: "box", href: link(c, "/m/assets", "register") },
      { label: "Depreciation", value: deprIn(c.from, c.to), fmt: "money", prev: deprIn(c.s.prevFrom, c.s.prevTo) || null, icon: "profit", href: link(c, "/m/assets", "depreciation") },
      { label: "Additions", value: sum(adds(c.from, c.to), (a) => a.cost), fmt: "money", prev: sum(adds(c.s.prevFrom, c.s.prevTo), (a) => a.cost) || null, icon: "cart", href: link(c, "/m/assets", "movements") },
    ],
    cards: [
      { title: "Net book value by group", body: { kind: "donut", money: true, data: byGroup, centerLabel: `NBV (${c.cur})` } },
      { title: "Depreciation by month", link: L(c, "/m/assets", "Schedule", "depreciation"), body: { kind: "trend", money: true, data: months(c.from, c.to).map((m) => ({ m, a: sum(all, (a) => depr(a, `${m}-28`) - depr(a, `${prevM(m)}-28`)) })), a: "Depreciation" } },
      { title: "Cost vs book value by group", body: { kind: "pair", money: true, data: group(live, (a) => a.asset_group || "No group", (a) => a.cost).map((g) => ({ label: g.label, cost: g.value, nbv: byGroup.find((x) => x.label === g.label)?.value ?? 0 })), a: { key: "cost", name: "Cost" }, b: { key: "nbv", name: "Net book value" } } },
      { title: "Book value by location", body: { kind: "rank", money: true, data: group(live, (a) => a.location || "Not set", (a) => nbv(a, c.asOf)).slice(0, 10) } },
      { title: "Additions & disposals", link: L(c, "/m/assets", "Movements", "movements"),
        stats: [{ label: "Added", value: N(adds(c.from, c.to).length) }, { label: "Added cost", value: S(sum(adds(c.from, c.to), (a) => a.cost)) }, { label: "Disposed", value: N(disp.length) }, { label: "Proceeds", value: S(sum(disp, (a) => a.disposal_amount ?? 0)) }],
        body: { kind: "table", head: ["Asset", "Movement", "Date", "Amount"], rows: [...adds(c.from, c.to).map((a) => [a.name, "Acquisition", a.acquisition_date, S(a.cost)]), ...disp.map((a) => [a.name, "Disposal", a.disposal_date, S(a.disposal_amount ?? 0)])].slice(0, 10) } },
      { title: "Largest assets", body: { kind: "table", head: ["Asset", "Cost", "NBV", "Used"], rows: [...live].sort((a, b) => b.cost - a.cost).slice(0, 10).map((a) => [a.name, S(a.cost), S(nbv(a, c.asOf)), P(ratio(depr(a, c.asOf), a.cost - a.salvage))]) } },
    ],
  };
} };

/* ------------------------------------------------------------------ Executive */
const executive: DashDef = { title: "Executive overview", sub: "The company on one page", demo: true, run: async (c) => {
  const pc = prevCtx(c);
  const sm = await salesMonthly(c), smP = await salesMonthly(pc);
  const ar = await sql<{ v: number }[]>`select coalesce(sum(amount_mst - settle_mst),0)::float v from d365.cust_trans where company = ${c.company} and trans_date <= ${c.asOf} and (closed is null or closed > ${c.asOf})`;
  const ap = await vendorOpen(c);
  const stock = await stockAt(c, c.asOf);
  const bt = [...(await bankRows(c))];
  const docs = await sql<{ k: string; n: number }[]>`
    select 'Open sales orders' k, count(*)::int n from d365.sales_orders where company = ${c.company} and status = 1
    union all select 'Open purchase orders', count(*)::int from d365.purch_orders where company = ${c.company} and status in (1,2)
    union all select 'Open production orders', count(*)::int from d365.prod_orders where company = ${c.company} and status < 5
    union all select 'Transfers not received', count(*)::int from d365.transfer_orders where company = ${c.company} and status < 2`;
  const topC = await sql<{ label: string; value: number }[]>`
    select coalesce(c.name, v.customer) label, sum(v.line_amount)::float value from d365.v_sales v left join d365.customers c on c.company = v.company and c.account = v.customer
    where ${salesWhere(c.s)} group by 1 order by 2 desc limit 10`;
  const sales = sum(sm, (r) => r.sales), gp = sales - sum(sm, (r) => r.cost), salesP = sum(smP, (r) => r.sales), gpP = salesP - sum(smP, (r) => r.cost);
  const balAt = (d: string) => sum(bt.filter((b) => b.trans_date <= d), (b) => b.amount);
  const payables = sum(ap, (r) => Math.max(0, r.amount - r.paid)), inv = sum(stock, (r) => r.value);
  return {
    tiles: [
      { label: "Net sales", value: sales, fmt: "money", prev: salesP, icon: "money", href: link(c, "/") },
      { label: "Gross profit", value: gp, fmt: "money", prev: gpP, icon: "profit", href: link(c, "/m/margin") },
      { label: "Gross margin", value: ratio(gp, sales), fmt: "pct", prev: salesP ? gpP / salesP : null, icon: "pie" },
      { label: "Cash & bank", value: balAt(c.asOf), fmt: "money", prev: balAt(c.s.prevTo) || null, icon: "bank", href: link(c, "/m/cash") },
      { label: "Receivables", value: ar[0].v, fmt: "money", icon: "users", href: link(c, "/m/receivables") },
      { label: "Payables", value: payables, fmt: "money", icon: "doc", href: link(c, "/m/payables") },
    ],
    cards: [
      { title: "Sales and gross profit", body: { kind: "pair", money: true, data: sm.map((r) => ({ label: ml(r.m), sales: r.sales, gp: r.sales - r.cost })), a: { key: "sales", name: "Net sales" }, b: { key: "gp", name: "Gross profit" } } },
      { title: "Cash balance at month end", body: { kind: "trend", money: true, data: months(c.from, c.to).map((m) => ({ m, a: balAt(`${m}-31`) })), a: "Cash & bank" } },
      { title: "Working capital", stats: [{ label: "Net working capital", value: S(ar[0].v + inv + balAt(c.asOf) - payables) }, { label: "Payables", value: S(payables) }],
        body: { kind: "donut", money: true, data: [{ label: "Receivables", value: ar[0].v }, { label: "Inventory", value: inv }, { label: "Cash & bank", value: balAt(c.asOf) }], centerLabel: `Current assets (${c.cur})` } },
      { title: "Top 10 customers", link: L(c, "/sales/performance", "Sales performance"), body: { kind: "bars", cols: ["Customer", undefined, `Sales (${c.cur})`], rows: topC.map((r) => ({ a: r.label, value: r.value })) } },
      { title: "Open documents", link: L(c, "/m/transactions", "Transactions"), body: { kind: "rank", data: docs.map((d) => ({ label: d.k, value: d.n })) } },
      { title: "Inventory by item group", link: L(c, "/m/inventory", "Inventory"), body: { kind: "donut", money: true, data: group(stock, (r) => r.item_group || "No group", (r) => r.value), centerLabel: `Stock (${c.cur})` } },
    ],
  };
} };

export const DASHBOARDS: Record<string, DashDef> = { executive, transactions, receivables, purchasing, payables, inventory, warehouse, production, cash, assets };
