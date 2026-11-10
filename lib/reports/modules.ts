import "server-only";
import { sql } from "../db";
import type { Col } from "@/components/DataTable";
import type { Tone } from "@/components/ui";
import { invoicePayments } from "./ops";
import type { Scope } from "../filters";

/* Module reports (dashboards + reports from the approved list) as data specs rendered by ModuleView.
   "demo" reports read the light demo tables (d365.demo_*) until the custom D365 entities are synced. */

export interface Ctx { s: Scope; company: string; from: string; to: string; asOf: string; cur: string; q: Record<string, string | undefined> }
export interface KpiSpec { label: string; value: string; note?: string; tone?: Tone }
export interface ChartSpec { title: string; sub?: string; kind: "rank" | "bucket" | "pair"; data: any[]; a?: { key: string; name: string }; b?: { key: string; name: string }; money?: boolean }
export interface TableSpec { title: string; sub?: string; cols: Col[]; rows: Record<string, any>[]; total?: Record<string, any>; maxHeight?: number }
export interface Spec { kpis?: KpiSpec[]; charts?: ChartSpec[]; tables?: TableSpec[]; note?: string }
export interface ReportDef { key: string; label: string; demo?: boolean; run: (c: Ctx) => Promise<Spec> }
export interface ModuleDef { key: string; title: string; sub: string; reports: ReportDef[] }

const M = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0); };
const money = (n: number, c: string) => `${c} ${M(n)}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : "–");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mlabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
const ramp = (i: number, n: number) => (i === 0 ? "var(--c1)" : `hsl(16 72% ${70 - ((i - 1) / Math.max(1, n - 2)) * 42}%)`);
const BUCKETS = [{ label: "Not due", lo: -1e9, hi: 0 }, { label: "1–30", lo: 1, hi: 30 }, { label: "31–60", lo: 31, hi: 60 }, { label: "61–90", lo: 61, hi: 90 }, { label: "Over 90", lo: 91, hi: 1e9 }];
const bucketOf = (d: number) => BUCKETS.findIndex((b) => d >= b.lo && d <= b.hi);

/** Run queries one after the other (one pooled connection per page). */
async function seq<T extends (() => Promise<any>)[]>(...fns: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: any[] = [];
  for (const f of fns) out.push(await f());
  return out as any;
}

/* ------------------------------------------------------------------ shared queries */
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

/* ------------------------------------------------------------------ Executive */
const executive: ModuleDef = { key: "executive", title: "Executive overview", sub: "The company on one page", reports: [{
  key: "overview", label: "Overview", demo: true, run: async (c) => {
    const [sm, ar, ap, stock, bank, so, po] = await seq(
      () => salesMonthly(c),
      () => sql<{ v: number }[]>`select coalesce(sum(amount_mst - settle_mst),0)::float v from d365.cust_trans where company = ${c.company} and trans_date <= ${c.asOf} and (closed is null or closed > ${c.asOf})`,
      () => vendorOpen(c), () => stockAt(c, c.asOf), () => bankRows(c),
      () => sql<{ n: number }[]>`select count(*)::int n from d365.sales_orders where company = ${c.company} and status = 1`,
      () => sql<{ n: number }[]>`select count(*)::int n from d365.purch_orders where company = ${c.company} and status in (1,2)`,
    );
    const sales = sum(sm, "sales"), gp = sales - sum(sm, "cost");
    const cash = bank.filter((b) => b.trans_date <= c.asOf).reduce((a, b) => a + b.amount, 0);
    const payables = ap.reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0);
    const inv = stock.reduce((a, r) => a + r.value, 0);
    const months = [...new Set(bank.map((b) => b.trans_date.slice(0, 7)))].sort();
    let run = 0; const cashM = months.map((m) => { run += bank.filter((b) => b.trans_date.slice(0, 7) === m).reduce((a, b) => a + b.amount, 0); return { label: mlabel(m), value: run, color: "var(--c1)" }; });
    return {
      kpis: [{ label: "Net sales", value: money(sales, c.cur) }, { label: "Gross profit", value: money(gp, c.cur), note: sales ? `${pct(gp / sales)} margin` : undefined, tone: "good" },
        { label: "Cash & bank", value: money(cash, c.cur), note: `at ${c.asOf}` }, { label: "Receivables", value: money(ar[0].v, c.cur) },
        { label: "Payables", value: money(payables, c.cur), tone: "warn" }, { label: "Inventory value", value: money(inv, c.cur), note: `${int(so[0].n)} open SO · ${int(po[0].n)} open PO` }],
      charts: [{ title: "Sales and gross profit by month", kind: "pair", money: true, data: sm.map((r) => ({ label: mlabel(r.m), sales: r.sales, gp: r.sales - r.cost })), a: { key: "sales", name: "Net sales" }, b: { key: "gp", name: "Gross profit" } },
        { title: "Cash balance at month end", kind: "bucket", money: true, data: cashM }],
    };
  } }] };

/* ------------------------------------------------------------------ Receivables (real data) */
const receivables: ModuleDef = { key: "receivables", title: "Receivables & collections", sub: "Customer balances, overdue invoices, credit and collections", reports: [
  { key: "overview", label: "Overview", run: async (c) => {
    const inv = await invoicePayments({ ...c.s, from: "1900-01-01", to: c.asOf }, c.asOf);
    const open = inv.filter((r) => r.status !== "Paid");
    const total = sum(open, "remaining");
    const over = open.filter((r) => (r.days_overdue ?? 0) > 0);
    const coll = await sql<{ m: string; v: number }[]>`select to_char(trans_date,'YYYY-MM') m, (-sum(amount_mst))::float v from d365.cust_trans where company = ${c.company} and trans_type = 15 and trans_date between ${c.from} and ${c.to} group by 1 order by 1`;
    const sm = await salesMonthly(c);
    const sales = sum(sm, "sales");
    const top = [...new Map(over.map((r) => [r.account, { label: r.name, value: over.filter((x) => x.account === r.account).reduce((a, x) => a + x.remaining, 0) }])).values()].sort((a, b) => b.value - a.value).slice(0, 8);
    const periodDays = Math.max(1, days(c.to, c.from) + 1);
    return {
      kpis: [{ label: "Customer balance", value: money(total, c.cur), note: `${int(open.length)} open invoices` }, { label: "Overdue", value: money(sum(over, "remaining"), c.cur), tone: "bad", note: `${int(over.length)} invoices` },
        { label: "DSO", value: sales ? `${((total / sales) * periodDays).toFixed(0)} d` : "–", note: "balance ÷ sales × days" }, { label: "Collected in period", value: money(sum(coll, "v"), c.cur), tone: "good" },
        { label: "Collected ÷ sales", value: sales ? pct(sum(coll, "v") / sales) : "–" }, { label: "Over 90 days", value: money(sum(over.filter((r) => (r.days_overdue ?? 0) > 90), "remaining"), c.cur), tone: "bad" }],
      charts: [{ title: "Open balance by days overdue", kind: "bucket", money: true, data: BUCKETS.map((b, i) => ({ label: b.label, value: sum(open.filter((r) => bucketOf(r.days_overdue ?? 0) === i), "remaining"), color: ramp(i, BUCKETS.length) })) },
        { title: "Collections vs sales by month", kind: "pair", money: true, data: sm.map((r) => ({ label: mlabel(r.m), sales: r.sales, coll: coll.find((x) => x.m === r.m)?.v ?? 0 })), a: { key: "sales", name: "Sales" }, b: { key: "coll", name: "Collected" } },
        { title: "Top overdue customers", kind: "rank", money: true, data: top }],
    };
  } },
  { key: "balances", label: "Customer balances", run: async (c) => {
    const rows = await sql<any[]>`
      select c.account, c.name, c.cust_group, c.payment_terms, c.credit_limit::float credit_limit,
        coalesce(sum(t.amount_mst - t.settle_mst) filter (where t.closed is null or t.closed > ${c.asOf}),0)::float balance,
        max(t.trans_date) filter (where t.trans_type = 15)::text last_payment
      from d365.customers c left join d365.cust_trans t on t.company = c.company and t.account = c.account and t.trans_date <= ${c.asOf}
      where c.company = ${c.company} group by 1,2,3,4,5 order by 6 desc`;
    for (const r of rows) { r.available = r.credit_limit > 0 ? r.credit_limit - r.balance : null; r.used = r.credit_limit > 0 ? r.balance / r.credit_limit : null; }
    return { kpis: [{ label: "Customers", value: int(rows.length) }, { label: "With a balance", value: int(rows.filter((r) => Math.abs(r.balance) > 0.005).length) },
        { label: "Total balance", value: money(sum(rows, "balance"), c.cur) }, { label: "Credit balances", value: money(sum(rows.filter((r) => r.balance < 0), "balance"), c.cur), note: "unapplied payments / credit notes" }],
      tables: [{ title: "Balance per customer", sub: `as of ${c.asOf}`, rows, total: { account: "Total", balance: sum(rows, "balance") },
        cols: [{ key: "account", label: "Account" }, { key: "name", label: "Customer" }, { key: "cust_group", label: "Group" }, { key: "payment_terms", label: "Terms" },
          { key: "credit_limit", label: "Credit limit", type: "money" }, { key: "balance", label: "Balance", type: "money" }, { key: "available", label: "Available", type: "money", tone: "signed" },
          { key: "used", label: "Limit used", type: "pct" }, { key: "last_payment", label: "Last payment", type: "date" }] }] };
  } },
  { key: "overdue", label: "Overdue invoices", run: async (c) => {
    const rows = (await invoicePayments({ ...c.s, from: "1900-01-01", to: c.asOf }, c.asOf)).filter((r) => r.status !== "Paid" && (r.days_overdue ?? 0) > 0).sort((a, b) => b.remaining - a.remaining);
    return { kpis: [{ label: "Overdue invoices", value: int(rows.length), tone: "bad" }, { label: "Overdue amount", value: money(sum(rows, "remaining"), c.cur), tone: "bad" },
        { label: "Avg days overdue", value: rows.length ? `${(sum(rows, "days_overdue") / rows.length).toFixed(0)} d` : "–" }, { label: "Customers", value: int(new Set(rows.map((r) => r.account)).size) }],
      tables: [{ title: "Overdue invoices, largest first", sub: `as of ${c.asOf}`, rows, total: { invoice: "Total", remaining: sum(rows, "remaining") },
        cols: [{ key: "invoice", label: "Invoice" }, { key: "account", label: "Account" }, { key: "name", label: "Customer" }, { key: "trans_date", label: "Invoice date", type: "date" },
          { key: "due_date", label: "Due", type: "date" }, { key: "amount", label: "Amount", type: "money" }, { key: "paid", label: "Paid", type: "money" },
          { key: "remaining", label: "Remaining", type: "money" }, { key: "days_overdue", label: "Days overdue", type: "int", tone: "badIfPositive" }] }] };
  } },
  { key: "credit", label: "Credit limit use", run: async (c) => {
    const rows = await sql<any[]>`
      select c.account, c.name, c.credit_limit::float credit_limit, coalesce(sum(t.amount_mst - t.settle_mst) filter (where t.closed is null or t.closed > ${c.asOf}),0)::float balance
      from d365.customers c left join d365.cust_trans t on t.company = c.company and t.account = c.account and t.trans_date <= ${c.asOf}
      where c.company = ${c.company} and c.credit_limit > 0 group by 1,2,3`;
    for (const r of rows) { r.used = r.balance / r.credit_limit; r.flag = r.used > 1 ? "Over limit" : r.used >= 0.8 ? "Near limit (80%+)" : ""; r.headroom = r.credit_limit - r.balance; }
    rows.sort((a, b) => b.used - a.used);
    return { kpis: [{ label: "Customers with a limit", value: int(rows.length) }, { label: "Over limit", value: int(rows.filter((r) => r.used > 1).length), tone: "bad" },
        { label: "Near limit (80%+)", value: int(rows.filter((r) => r.used >= 0.8 && r.used <= 1).length), tone: "warn" }, { label: "Total limits", value: money(sum(rows, "credit_limit"), c.cur) }],
      charts: [{ title: "Limit used – top customers", kind: "rank", data: rows.slice(0, 10).map((r) => ({ label: r.name, value: Math.round(r.used * 100) })) }],
      tables: [{ title: "Credit limit utilisation", rows, cols: [{ key: "account", label: "Account" }, { key: "name", label: "Customer" }, { key: "credit_limit", label: "Credit limit", type: "money" },
        { key: "balance", label: "Balance", type: "money" }, { key: "headroom", label: "Headroom", type: "money", tone: "signed" }, { key: "used", label: "Used", type: "pct" }, { key: "flag", label: "Flag" }] }] };
  } },
  { key: "payments", label: "Customer payments", run: async (c) => {
    const rows = await sql<any[]>`
      select t.trans_date::text, t.voucher, t.account, coalesce(cu.name, t.account) name, coalesce(nullif(t.paym_mode,''),'–') paym_mode, (-t.amount_mst)::float amount, t.txt
      from d365.cust_trans t left join d365.customers cu on cu.company = t.company and cu.account = t.account
      where t.company = ${c.company} and t.trans_type = 15 and t.trans_date between ${c.from} and ${c.to} order by t.trans_date desc`;
    const by = (k: string) => [...rows.reduce((m, r) => m.set(r[k], (m.get(r[k]) ?? 0) + r.amount), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return { kpis: [{ label: "Payments", value: int(rows.length) }, { label: "Collected", value: money(sum(rows, "amount"), c.cur), tone: "good" },
        { label: "Average payment", value: rows.length ? money(sum(rows, "amount") / rows.length, c.cur) : "–" }, { label: "Paying customers", value: int(new Set(rows.map((r) => r.account)).size) }],
      charts: [{ title: "Collected by customer", kind: "rank", money: true, data: by("name").slice(0, 10) }, { title: "By payment method", kind: "rank", money: true, data: by("paym_mode") }],
      tables: [{ title: "Customer payments", rows, total: { trans_date: "Total", amount: sum(rows, "amount") }, cols: [{ key: "trans_date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher" },
        { key: "account", label: "Account" }, { key: "name", label: "Customer" }, { key: "paym_mode", label: "Method" }, { key: "amount", label: "Amount", type: "money" }, { key: "txt", label: "Text", wrap: true }] }] };
  } },
] };

/* ------------------------------------------------------------------ Purchasing (demo lines) */
const purchLines = (c: Ctx) => sql<any[]>`
  select l.*, l.qty::float qty, l.received_qty::float received_qty, l.invoiced_qty::float invoiced_qty, l.price::float price, l.order_date::text order_date,
    l.delivery_date::text delivery_date, l.received_date::text received_date, coalesce(v.name, l.vendor) vendor_name, coalesce(i.name, l.item) item_name
  from d365.demo_purch_lines l left join d365.demo_vendors v on v.company = l.company and v.vendor = l.vendor left join d365.demo_items i on i.company = l.company and i.item = l.item
  where l.company = ${c.company} order by l.order_date desc, l.purchase_order, l.line`;
const purchasing: ModuleDef = { key: "purchasing", title: "Purchasing", sub: "Purchase orders, register, prices, delivery performance and pending receipts", reports: [
  { key: "overview", label: "Overview", demo: true, run: async (c) => {
    const all = await purchLines(c);
    const rows = all.filter((r) => r.order_date >= c.from && r.order_date <= c.to);
    const open = all.filter((r) => r.received_qty < r.qty && r.order_date <= c.asOf);
    const months = [...new Set(rows.map((r) => r.order_date.slice(0, 7)))].sort();
    const ap = await vendorOpen(c);
    const dueWeek = ap.filter((r) => r.amount - r.paid > 0.005 && r.due_date > c.asOf && days(r.due_date, c.asOf) <= 7);
    const byVendor = [...rows.reduce((m, r) => m.set(r.vendor_name, (m.get(r.vendor_name) ?? 0) + r.qty * r.price), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const recd = rows.filter((r) => r.received_date); const onTime = recd.filter((r) => r.received_date <= r.delivery_date).length;
    return { kpis: [{ label: "Purchases (ordered)", value: money(rows.reduce((a, r) => a + r.qty * r.price, 0), c.cur), note: `${int(new Set(rows.map((r) => r.purchase_order)).size)} orders` },
        { label: "Open order value", value: money(open.reduce((a, r) => a + (r.qty - r.received_qty) * r.price, 0), c.cur), note: `${int(new Set(open.map((r) => r.purchase_order)).size)} orders`, tone: "warn" },
        { label: "Vendor balance", value: money(ap.reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0), c.cur) }, { label: "Due in 7 days", value: money(dueWeek.reduce((a, r) => a + r.amount - r.paid, 0), c.cur), note: `${int(dueWeek.length)} invoices` },
        { label: "On-time delivery", value: recd.length ? pct(onTime / recd.length) : "–" }, { label: "Vendors used", value: int(new Set(rows.map((r) => r.vendor)).size) }],
      charts: [{ title: "Purchases by month", kind: "bucket", money: true, data: months.map((m) => ({ label: mlabel(m), value: rows.filter((r) => r.order_date.startsWith(m)).reduce((a, r) => a + r.qty * r.price, 0), color: "var(--c1)" })) },
        { title: "Top vendors", kind: "rank", money: true, data: byVendor.slice(0, 8) }] };
  } },
  { key: "open", label: "Open purchase orders", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.received_qty < r.qty && r.order_date <= c.asOf).map((r) => ({ ...r, remaining: r.qty - r.received_qty, value: (r.qty - r.received_qty) * r.price, late: r.delivery_date < c.asOf ? days(c.asOf, r.delivery_date) : 0 }));
    return { kpis: [{ label: "Open lines", value: int(rows.length) }, { label: "Open value", value: money(sum(rows, "value"), c.cur) }, { label: "Past delivery date", value: int(rows.filter((r) => r.late > 0).length), tone: "bad" }],
      tables: [{ title: "Open purchase order lines", rows, total: { purchase_order: "Total", value: sum(rows, "value") }, cols: [{ key: "purchase_order", label: "PO" }, { key: "line", label: "Line", type: "int" },
        { key: "vendor_name", label: "Vendor" }, { key: "item_name", label: "Item" }, { key: "order_date", label: "Ordered", type: "date" }, { key: "delivery_date", label: "Delivery", type: "date" },
        { key: "qty", label: "Ordered qty", type: "num" }, { key: "received_qty", label: "Received", type: "num" }, { key: "remaining", label: "Remaining", type: "num" },
        { key: "value", label: "Open value", type: "money" }, { key: "late", label: "Days late", type: "int", tone: "badIfPositive" }] }] };
  } },
  { key: "register", label: "Purchase register", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.order_date >= c.from && r.order_date <= c.to).map((r) => ({ ...r, amount: r.qty * r.price }));
    return { kpis: [{ label: "Lines", value: int(rows.length) }, { label: "Amount", value: money(sum(rows, "amount"), c.cur) }, { label: "Items", value: int(new Set(rows.map((r) => r.item)).size) }],
      charts: [{ title: "By item", kind: "rank", money: true, data: [...rows.reduce((m, r) => m.set(r.item_name, (m.get(r.item_name) ?? 0) + r.amount), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10) }],
      tables: [{ title: "Purchase lines", rows, total: { purchase_order: "Total", amount: sum(rows, "amount") }, cols: [{ key: "purchase_order", label: "PO" }, { key: "order_date", label: "Date", type: "date" },
        { key: "vendor_name", label: "Vendor" }, { key: "item_name", label: "Item" }, { key: "warehouse", label: "Warehouse" }, { key: "qty", label: "Qty", type: "num" }, { key: "price", label: "Price", type: "money" }, { key: "amount", label: "Amount", type: "money" }] }] };
  } },
  { key: "price", label: "Purchase price history", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.order_date >= c.from && r.order_date <= c.to);
    const by = new Map<string, any>();
    for (const r of [...rows].sort((a, b) => a.order_date.localeCompare(b.order_date))) {
      const k = `${r.item}|${r.vendor}`;
      const e = by.get(k) ?? { item_name: r.item_name, vendor_name: r.vendor_name, first_date: r.order_date, first: r.price, last: r.price, last_date: r.order_date, min: r.price, max: r.price, n: 0, qty: 0, amt: 0 };
      e.last = r.price; e.last_date = r.order_date; e.min = Math.min(e.min, r.price); e.max = Math.max(e.max, r.price); e.n++; e.qty += r.qty; e.amt += r.qty * r.price;
      by.set(k, e);
    }
    const out = [...by.values()].map((e) => ({ ...e, avg: e.amt / e.qty, change: e.first ? (e.last - e.first) / e.first : 0 })).sort((a, b) => b.change - a.change);
    return { kpis: [{ label: "Item × vendor pairs", value: int(out.length) }, { label: "Prices up", value: int(out.filter((r) => r.change > 0.005).length), tone: "warn" }, { label: "Prices down", value: int(out.filter((r) => r.change < -0.005).length), tone: "good" }],
      tables: [{ title: "Price change per item and vendor", sub: "first vs last order in the period", rows: out, cols: [{ key: "item_name", label: "Item" }, { key: "vendor_name", label: "Vendor" }, { key: "n", label: "Orders", type: "int" },
        { key: "first_date", label: "First", type: "date" }, { key: "first", label: "First price", type: "money" }, { key: "last_date", label: "Last", type: "date" }, { key: "last", label: "Last price", type: "money" },
        { key: "min", label: "Min", type: "money" }, { key: "max", label: "Max", type: "money" }, { key: "avg", label: "Weighted avg", type: "money" }, { key: "change", label: "Change", type: "pct", tone: "signed" }] }] };
  } },
  { key: "delivery", label: "Vendor delivery performance", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.received_date && r.received_date >= c.from && r.received_date <= c.to);
    const by = new Map<string, any>();
    for (const r of rows) {
      const e = by.get(r.vendor) ?? { vendor_name: r.vendor_name, lines: 0, on_time: 0, late: 0, late_days: 0, short: 0 };
      const d = days(r.received_date, r.delivery_date);
      e.lines++; if (d <= 0) e.on_time++; else { e.late++; e.late_days += d; } if (r.received_qty < r.qty) e.short++;
      by.set(r.vendor, e);
    }
    const out = [...by.values()].map((e) => ({ ...e, on_time_pct: e.on_time / e.lines, avg_late: e.late ? e.late_days / e.late : 0, fill: 1 - e.short / e.lines })).sort((a, b) => a.on_time_pct - b.on_time_pct);
    return { kpis: [{ label: "Receipts", value: int(rows.length) }, { label: "On time", value: rows.length ? pct(sum(out, "on_time") / rows.length) : "–" }, { label: "Short deliveries", value: int(sum(out, "short")), tone: "warn" }],
      charts: [{ title: "On-time % by vendor", kind: "rank", data: out.map((e) => ({ label: e.vendor_name, value: Math.round(e.on_time_pct * 100) })) }],
      tables: [{ title: "Delivery performance per vendor", rows: out, cols: [{ key: "vendor_name", label: "Vendor" }, { key: "lines", label: "Receipts", type: "int" }, { key: "on_time", label: "On time", type: "int" },
        { key: "late", label: "Late", type: "int" }, { key: "on_time_pct", label: "On-time %", type: "pct" }, { key: "avg_late", label: "Avg days late", type: "num" }, { key: "fill", label: "Full quantity", type: "pct" }] }] };
  } },
  { key: "receipts", label: "Pending receipts", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.received_qty < r.qty && r.order_date <= c.asOf).map((r) => ({ ...r, pending: r.qty - r.received_qty, value: (r.qty - r.received_qty) * r.price, in_days: days(r.delivery_date, c.asOf) }))
      .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
    return { kpis: [{ label: "Pending lines", value: int(rows.length) }, { label: "Overdue", value: int(rows.filter((r) => r.in_days < 0).length), tone: "bad" }, { label: "Next 14 days", value: int(rows.filter((r) => r.in_days >= 0 && r.in_days <= 14).length) }],
      tables: [{ title: "Expected receipts by date", rows, cols: [{ key: "delivery_date", label: "Expected", type: "date" }, { key: "in_days", label: "In days", type: "int" }, { key: "purchase_order", label: "PO" },
        { key: "vendor_name", label: "Vendor" }, { key: "item_name", label: "Item" }, { key: "warehouse", label: "Warehouse" }, { key: "pending", label: "Pending qty", type: "num" }, { key: "value", label: "Value", type: "money" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Payables (demo vendor transactions) */
const payables: ModuleDef = { key: "payables", title: "Payables", sub: "Vendor aging, statements, payments due and payments made", reports: [
  { key: "aging", label: "Vendor aging", demo: true, run: async (c) => {
    const ap = (await vendorOpen(c)).map((r) => ({ ...r, open: r.amount - r.paid, od: days(c.asOf, r.due_date) })).filter((r) => r.open > 0.005);
    const by = new Map<string, any>();
    for (const r of ap) { const e = by.get(r.vendor) ?? { vendor: r.vendor, name: r.name, total: 0, ...Object.fromEntries(BUCKETS.map((_, i) => [`b${i}`, 0])) }; e[`b${bucketOf(r.od)}`] += r.open; e.total += r.open; by.set(r.vendor, e); }
    const rows = [...by.values()].sort((a, b) => b.total - a.total);
    return { kpis: [{ label: "Vendor balance", value: money(sum(ap, "open"), c.cur) }, { label: "Overdue", value: money(sum(ap.filter((r) => r.od > 0), "open"), c.cur), tone: "bad" }, { label: "Open invoices", value: int(ap.length) }, { label: "Vendors", value: int(rows.length) }],
      charts: [{ title: "Payables by days overdue", kind: "bucket", money: true, data: BUCKETS.map((b, i) => ({ label: b.label, value: sum(ap.filter((r) => bucketOf(r.od) === i), "open"), color: ramp(i, BUCKETS.length) })) }],
      tables: [{ title: "Aging by vendor", sub: `as of ${c.asOf}`, rows, total: { vendor: "Total", total: sum(rows, "total"), ...Object.fromEntries(BUCKETS.map((_, i) => [`b${i}`, sum(rows, `b${i}`)])) },
        cols: [{ key: "vendor", label: "Vendor" }, { key: "name", label: "Name" }, ...BUCKETS.map((b, i) => ({ key: `b${i}`, label: b.label, type: "money" as const })), { key: "total", label: "Total", type: "money" }] }] };
  } },
  { key: "statement", label: "Vendor statement", demo: true, run: async (c) => {
    const rows = await sql<any[]>`
      select t.vendor, coalesce(v.name, t.vendor) name,
        coalesce(-sum(t.amount) filter (where t.trans_date < ${c.from}),0)::float opening,
        coalesce(-sum(t.amount) filter (where t.kind = 'Invoice' and t.trans_date between ${c.from} and ${c.to}),0)::float invoiced,
        coalesce(sum(t.amount) filter (where t.kind = 'Payment' and t.trans_date between ${c.from} and ${c.to}),0)::float paid,
        coalesce(-sum(t.amount) filter (where t.trans_date <= ${c.to}),0)::float closing, max(t.trans_date) filter (where t.kind = 'Payment' and t.trans_date <= ${c.to})::text last_payment
      from d365.demo_vend_trans t left join d365.demo_vendors v on v.company = t.company and v.vendor = t.vendor where t.company = ${c.company} group by 1,2 order by 6 desc`;
    const vsel = c.q.vendor && rows.find((r) => r.vendor === c.q.vendor) ? c.q.vendor : rows[0]?.vendor;
    const lines = vsel ? await sql<any[]>`select trans_date::text, kind, voucher, invoice, due_date::text, (-amount)::float amount from d365.demo_vend_trans where company = ${c.company} and vendor = ${vsel} and trans_date between ${c.from} and ${c.to} order by trans_date, id` : [];
    let bal = rows.find((r) => r.vendor === vsel)?.opening ?? 0;
    for (const l of lines) { bal += l.amount; l.balance = bal; l.debit = l.amount < 0 ? -l.amount : null; l.credit = l.amount > 0 ? l.amount : null; }
    return { kpis: [{ label: "Opening", value: money(sum(rows, "opening"), c.cur) }, { label: "Invoiced", value: money(sum(rows, "invoiced"), c.cur) }, { label: "Paid", value: money(sum(rows, "paid"), c.cur), tone: "good" }, { label: "Closing", value: money(sum(rows, "closing"), c.cur) }],
      tables: [{ title: "Summary per vendor", sub: "click a vendor for its statement", rows, total: { vendor: "Total", opening: sum(rows, "opening"), invoiced: sum(rows, "invoiced"), paid: sum(rows, "paid"), closing: sum(rows, "closing") },
        cols: [{ key: "vendor", label: "Vendor", href: `?${new URLSearchParams({ company: c.company, from: c.from, to: c.to, r: "statement" })}&vendor={vendor}` }, { key: "name", label: "Name" }, { key: "opening", label: "Opening", type: "money" },
          { key: "invoiced", label: "Invoiced", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "closing", label: "Closing", type: "money" }, { key: "last_payment", label: "Last payment", type: "date" }] },
        { title: `Statement · ${rows.find((r) => r.vendor === vsel)?.name ?? ""}`, rows: lines, maxHeight: 420, cols: [{ key: "trans_date", label: "Date", type: "date" }, { key: "kind", label: "Type" }, { key: "voucher", label: "Voucher" },
          { key: "invoice", label: "Invoice" }, { key: "due_date", label: "Due", type: "date" }, { key: "credit", label: "Invoice (Cr)", type: "money" }, { key: "debit", label: "Payment (Dr)", type: "money" }, { key: "balance", label: "Balance", type: "money" }] }] };
  } },
  { key: "due", label: "Payments due", demo: true, run: async (c) => {
    const ap = (await vendorOpen(c)).map((r) => ({ ...r, open: r.amount - r.paid, in_days: days(r.due_date, c.asOf) })).filter((r) => r.open > 0.005).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const W = [{ label: "Overdue", f: (d: number) => d < 0 }, { label: "This week", f: (d: number) => d >= 0 && d <= 7 }, { label: "Next week", f: (d: number) => d > 7 && d <= 14 },
      { label: "15–30 days", f: (d: number) => d > 14 && d <= 30 }, { label: "Later", f: (d: number) => d > 30 }];
    return { kpis: W.map((w) => ({ label: w.label, value: money(sum(ap.filter((r) => w.f(r.in_days)), "open"), c.cur), tone: w.label === "Overdue" ? ("bad" as const) : null })),
      charts: [{ title: "Due by week", kind: "bucket", money: true, data: W.map((w, i) => ({ label: w.label, value: sum(ap.filter((r) => w.f(r.in_days)), "open"), color: i === 0 ? "hsl(16 72% 45%)" : "var(--c1)" })) }],
      tables: [{ title: "Open vendor invoices by due date", rows: ap.map((r) => ({ ...r, week: W.find((w) => w.f(r.in_days))?.label })), total: { due_date: "Total", open: sum(ap, "open") },
        cols: [{ key: "due_date", label: "Due", type: "date" }, { key: "week", label: "When" }, { key: "vendor", label: "Vendor" }, { key: "name", label: "Name" }, { key: "invoice", label: "Invoice" },
          { key: "amount", label: "Amount", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "open", label: "To pay", type: "money" }] }] };
  } },
  { key: "payments", label: "Vendor payments", demo: true, run: async (c) => {
    const rows = await sql<any[]>`select p.trans_date::text, p.voucher, p.invoice, p.vendor, coalesce(v.name, p.vendor) name, p.paym_mode, p.amount::float amount,
        (select i.due_date::text from d365.demo_vend_trans i where i.company = p.company and i.invoice = p.invoice and i.kind = 'Invoice' limit 1) due_date
      from d365.demo_vend_trans p left join d365.demo_vendors v on v.company = p.company and v.vendor = p.vendor
      where p.company = ${c.company} and p.kind = 'Payment' and p.trans_date between ${c.from} and ${c.to} order by p.trans_date desc`;
    for (const r of rows) r.vs_due = r.due_date ? days(r.trans_date, r.due_date) : null;
    const months = [...new Set(rows.map((r) => r.trans_date.slice(0, 7)))].sort();
    return { kpis: [{ label: "Payments", value: int(rows.length) }, { label: "Paid", value: money(sum(rows, "amount"), c.cur) }, { label: "Paid late", value: int(rows.filter((r) => (r.vs_due ?? 0) > 0).length), tone: "warn" }],
      charts: [{ title: "Payments by month", kind: "bucket", money: true, data: months.map((m) => ({ label: mlabel(m), value: sum(rows.filter((r) => r.trans_date.startsWith(m)), "amount"), color: "var(--c1)" })) }],
      tables: [{ title: "Vendor payments", rows, total: { trans_date: "Total", amount: sum(rows, "amount") }, cols: [{ key: "trans_date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher" }, { key: "invoice", label: "Invoice" },
        { key: "name", label: "Vendor" }, { key: "paym_mode", label: "Method" }, { key: "amount", label: "Amount", type: "money" }, { key: "due_date", label: "Due", type: "date" }, { key: "vs_due", label: "Days after due", type: "int", tone: "badIfPositive" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Inventory (demo transactions with cost) */
const itx = (c: Ctx) => sql<any[]>`
  select t.id, t.item, coalesce(i.name, t.item) name, coalesce(i.item_group,'') item_group, t.site, t.warehouse, t.batch, t.expiry::text expiry, t.trans_date::text trans_date,
    t.kind, t.reference, t.qty::float qty, t.cost_amount::float cost_amount
  from d365.demo_invent_trans t left join d365.demo_items i on i.company = t.company and i.item = t.item where t.company = ${c.company} order by t.trans_date, t.id`;
const inventory: ModuleDef = { key: "inventory", title: "Inventory", sub: "Stock by site and warehouse, valuation, movement, slow movers, reorder, turnover and batches", reports: [
  { key: "overview", label: "Overview", demo: true, run: async (c) => {
    const [st, tx] = await seq(() => stockAt(c, c.asOf), () => itx(c));
    const byItem = new Map<string, any>();
    for (const r of st) { const e = byItem.get(r.item) ?? { ...r, qty: 0, value: 0 }; e.qty += r.qty; e.value += r.value; byItem.set(r.item, e); }
    const items = [...byItem.values()];
    const out = items.filter((r) => r.qty <= 0).length;
    const lastMove = new Map<string, string>(); for (const t of tx) if (t.kind === "Sales issue" && t.trans_date <= c.asOf) lastMove.set(t.item, t.trans_date);
    const slow = items.filter((r) => r.qty > 0 && (!lastMove.has(r.item) || days(c.asOf, lastMove.get(r.item)!) > 90));
    const cogs = -sum(tx.filter((t) => t.kind === "Sales issue" && t.trans_date >= c.from && t.trans_date <= c.to), "cost_amount");
    const value = sum(items, "value");
    const months = [...new Set(tx.filter((t) => t.trans_date >= c.from && t.trans_date <= c.to).map((t) => t.trans_date.slice(0, 7)))].sort();
    return { kpis: [{ label: "Inventory value", value: money(value, c.cur) }, { label: "Items in stock", value: int(items.filter((r) => r.qty > 0).length) }, { label: "Out of stock", value: int(out), tone: out ? "bad" : "good" },
        { label: "Slow-moving (90 d)", value: int(slow.length), note: money(sum(slow, "value"), c.cur), tone: "warn" }, { label: "Turnover", value: value ? `${(cogs / value).toFixed(1)}×` : "–", note: "cost of sales ÷ stock value" },
        { label: "Below reorder point", value: int(items.filter((r) => r.qty < r.reorder_point).length), tone: "warn" }],
      charts: [{ title: "Stock value by warehouse", kind: "rank", money: true, data: [...st.reduce((m, r) => m.set(`${r.site} / ${r.warehouse}`, (m.get(`${r.site} / ${r.warehouse}`) ?? 0) + r.value), new Map<string, number>())].map(([label, value]) => ({ label, value })) },
        { title: "Receipts vs issues by month (cost)", kind: "pair", money: true, a: { key: "in", name: "In" }, b: { key: "out", name: "Out" },
          data: months.map((m) => ({ label: mlabel(m), in: sum(tx.filter((t) => t.trans_date.startsWith(m) && t.qty > 0 && t.kind !== "Opening"), "cost_amount"), out: -sum(tx.filter((t) => t.trans_date.startsWith(m) && t.qty < 0), "cost_amount") })) }] };
  } },
  { key: "onhand", label: "On-hand by site & warehouse", run: async (c) => {
    const rows = await sql<any[]>`select o.item, coalesce(max(i.name), o.item) name, o.site, sum(o.physical)::float physical, sum(o.reserved)::float reserved, sum(o.available)::float available
      from d365.onhand o left join d365.demo_items i on i.company = o.company and i.item = o.item where o.company = ${c.company} group by o.item, o.site order by o.item, o.site`;
    return { kpis: [{ label: "Item × site lines", value: int(rows.length) }, { label: "Physical", value: int(sum(rows, "physical")) }, { label: "Reserved", value: int(sum(rows, "reserved")) }, { label: "Available", value: int(sum(rows, "available")) }],
      tables: [{ title: "On-hand (from D365)", sub: "current snapshot, not affected by the period", rows, total: { item: "Total", physical: sum(rows, "physical"), reserved: sum(rows, "reserved"), available: sum(rows, "available") },
        cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "site", label: "Site" }, { key: "physical", label: "Physical", type: "num" }, { key: "reserved", label: "Reserved", type: "num" }, { key: "available", label: "Available", type: "num", tone: "signed" }] }] };
  } },
  { key: "valuation", label: "Inventory valuation", demo: true, run: async (c) => {
    const st = (await stockAt(c, c.asOf)).filter((r) => Math.abs(r.qty) > 0.001);
    const byGroup = [...st.reduce((m, r) => m.set(r.item_group || "Other", (m.get(r.item_group || "Other") ?? 0) + r.value), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return { kpis: [{ label: "Value", value: money(sum(st, "value"), c.cur) }, { label: "Quantity", value: int(sum(st, "qty")) }, { label: "Item groups", value: int(byGroup.length) }],
      charts: [{ title: "Value by item group", kind: "rank", money: true, data: byGroup }],
      tables: [{ title: "Valuation by item, site and warehouse", sub: `as of ${c.asOf}`, rows: st.map((r) => ({ ...r, avg_cost: r.qty ? r.value / r.qty : 0 })), total: { item: "Total", qty: sum(st, "qty"), value: sum(st, "value") },
        cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "item_group", label: "Group" }, { key: "site", label: "Site" }, { key: "warehouse", label: "Warehouse" },
          { key: "qty", label: "Qty", type: "num" }, { key: "avg_cost", label: "Avg cost", type: "money" }, { key: "value", label: "Value", type: "money" }] }] };
  } },
  { key: "movement", label: "Item movement", demo: true, run: async (c) => {
    const tx = await itx(c);
    const items = [...new Map(tx.map((t) => [t.item, t.name])).entries()];
    const sel = c.q.item && items.some(([k]) => k === c.q.item) ? c.q.item! : items[0]?.[0];
    let q = 0, v = 0;
    const rows = tx.filter((t) => t.item === sel && t.trans_date <= c.to).map((t) => { q += t.qty; v += t.cost_amount; return { ...t, in_qty: t.qty > 0 ? t.qty : null, out_qty: t.qty < 0 ? -t.qty : null, bal_qty: q, bal_value: v }; })
      .filter((t) => t.trans_date >= c.from || t.kind === "Opening");
    return { kpis: [{ label: "Item", value: items.find(([k]) => k === sel)?.[1] ?? "–" }, { label: "In", value: int(sum(rows, "in_qty")) }, { label: "Out", value: int(sum(rows, "out_qty")) }, { label: "Closing qty", value: int(q) }],
      tables: [{ title: "Items", sub: "click an item to see its movement", maxHeight: 260, rows: items.map(([item, name]) => ({ item, name })), cols: [{ key: "item", label: "Item", href: `?${new URLSearchParams({ company: c.company, from: c.from, to: c.to, r: "movement" })}&item={item}` }, { key: "name", label: "Name" }] },
        { title: "Movement with running balance", rows, cols: [{ key: "trans_date", label: "Date", type: "date" }, { key: "kind", label: "Type" }, { key: "reference", label: "Reference" }, { key: "warehouse", label: "Warehouse" },
          { key: "in_qty", label: "In", type: "num" }, { key: "out_qty", label: "Out", type: "num" }, { key: "bal_qty", label: "Balance qty", type: "num" }, { key: "cost_amount", label: "Cost", type: "money" }, { key: "bal_value", label: "Balance value", type: "money" }] }] };
  } },
  { key: "slow", label: "Slow-moving & dead stock", demo: true, run: async (c) => {
    const [st, tx] = await seq(() => stockAt(c, c.asOf), () => itx(c));
    const last = new Map<string, string>(); for (const t of tx) if (t.qty < 0 && t.trans_date <= c.asOf) last.set(t.item, t.trans_date);
    const byItem = new Map<string, any>(); for (const r of st) { const e = byItem.get(r.item) ?? { item: r.item, name: r.name, qty: 0, value: 0 }; e.qty += r.qty; e.value += r.value; byItem.set(r.item, e); }
    const rows = [...byItem.values()].filter((r) => r.qty > 0).map((r) => { const d = last.has(r.item) ? days(c.asOf, last.get(r.item)!) : 9999; return { ...r, last_issue: last.get(r.item) ?? null, idle: d === 9999 ? null : d, band: d > 365 ? "Over 365 days" : d > 180 ? "181–365 days" : d > 90 ? "91–180 days" : d > 30 ? "31–90 days" : "Moving" }; })
      .sort((a, b) => (b.idle ?? 1e9) - (a.idle ?? 1e9));
    const bands = ["Moving", "31–90 days", "91–180 days", "181–365 days", "Over 365 days"];
    return { kpis: bands.slice(1).map((b) => ({ label: b, value: money(sum(rows.filter((r) => r.band === b), "value"), c.cur), note: `${int(rows.filter((r) => r.band === b).length)} items`, tone: b === "Over 365 days" ? ("bad" as const) : null })),
      charts: [{ title: "Stock value by days since last issue", kind: "bucket", money: true, data: bands.map((b, i) => ({ label: b, value: sum(rows.filter((r) => r.band === b), "value"), color: ramp(i, bands.length) })) }],
      tables: [{ title: "Items by days since last issue", rows, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "qty", label: "Qty", type: "num" }, { key: "value", label: "Value", type: "money" },
        { key: "last_issue", label: "Last issue", type: "date" }, { key: "idle", label: "Days idle", type: "int", tone: "badIfPositive" }, { key: "band", label: "Band" }] }] };
  } },
  { key: "reorder", label: "Below reorder point", demo: true, run: async (c) => {
    const st = await stockAt(c, c.asOf);
    const byItem = new Map<string, any>(); for (const r of st) { const e = byItem.get(r.item) ?? { item: r.item, name: r.name, qty: 0, reorder_point: r.reorder_point, safety_stock: r.safety_stock, unit_cost: r.unit_cost }; e.qty += r.qty; byItem.set(r.item, e); }
    const rows = [...byItem.values()].filter((r) => r.qty < r.reorder_point).map((r) => ({ ...r, suggest: Math.max(0, Math.round(r.reorder_point * 2 - r.qty)), status: r.qty <= 0 ? "Out of stock" : r.qty < r.safety_stock ? "Below safety stock" : "Below reorder point" }))
      .map((r) => ({ ...r, value: r.suggest * r.unit_cost })).sort((a, b) => a.qty / Math.max(1, a.reorder_point) - b.qty / Math.max(1, b.reorder_point));
    return { kpis: [{ label: "Items to reorder", value: int(rows.length), tone: "warn" }, { label: "Below safety stock", value: int(rows.filter((r) => r.status !== "Below reorder point").length), tone: "bad" }, { label: "Suggested order value", value: money(sum(rows, "value"), c.cur) }],
      tables: [{ title: "Items below reorder point", sub: "suggested qty brings stock to 2 × reorder point", rows, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "qty", label: "On hand", type: "num" },
        { key: "safety_stock", label: "Safety stock", type: "num" }, { key: "reorder_point", label: "Reorder point", type: "num" }, { key: "status", label: "Status" }, { key: "suggest", label: "Suggested qty", type: "num" }, { key: "value", label: "Value", type: "money" }] }] };
  } },
  { key: "turnover", label: "Inventory turnover", demo: true, run: async (c) => {
    const [tx, open, close] = await seq(() => itx(c), () => stockAt(c, c.from), () => stockAt(c, c.to));
    const agg = (rows: any[]) => rows.reduce((m, r) => m.set(r.item, (m.get(r.item) ?? 0) + r.value), new Map<string, number>());
    const o = agg(open), cl = agg(close);
    const span = Math.max(1, days(c.to, c.from) + 1);
    const names = new Map(tx.map((t) => [t.item, t.name]));
    const rows = [...names.keys()].map((item) => {
      const cogs = -sum(tx.filter((t) => t.item === item && t.kind === "Sales issue" && t.trans_date >= c.from && t.trans_date <= c.to), "cost_amount");
      const avg = ((o.get(item) ?? 0) + (cl.get(item) ?? 0)) / 2;
      return { item, name: names.get(item), cogs, avg_stock: avg, turns: avg > 0 ? cogs / avg : null, cover: cogs > 0 ? ((cl.get(item) ?? 0) / cogs) * span : null };
    }).sort((a, b) => (b.turns ?? -1) - (a.turns ?? -1));
    const tc = sum(rows, "cogs"), ta = sum(rows, "avg_stock");
    return { kpis: [{ label: "Cost of sales", value: money(tc, c.cur) }, { label: "Average stock", value: money(ta, c.cur) }, { label: "Turnover", value: ta ? `${(tc / ta).toFixed(1)}×` : "–" }, { label: "Days of cover", value: tc ? `${((sum(close, "value") / tc) * span).toFixed(0)} d` : "–" }],
      tables: [{ title: "Turnover and days of cover per item", rows, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "cogs", label: "Cost of sales", type: "money" }, { key: "avg_stock", label: "Avg stock", type: "money" },
        { key: "turns", label: "Turns", type: "num" }, { key: "cover", label: "Days of cover", type: "int" }] }] };
  } },
  { key: "batch", label: "Batch & expiry", demo: true, run: async (c) => {
    const rows = await sql<any[]>`select t.item, coalesce(max(i.name), t.item) name, t.batch, t.warehouse, max(t.expiry)::text expiry, sum(t.qty)::float qty, sum(t.cost_amount)::float value
      from d365.demo_invent_trans t left join d365.demo_items i on i.company = t.company and i.item = t.item
      where t.company = ${c.company} and t.batch is not null and t.trans_date <= ${c.asOf} group by t.item, t.batch, t.warehouse having sum(t.qty) > 0 order by max(t.expiry)`;
    for (const r of rows) { r.days_left = r.expiry ? days(r.expiry, c.asOf) : null; r.flag = r.days_left === null ? "" : r.days_left < 0 ? "Expired" : r.days_left <= 60 ? "Expires within 60 days" : ""; }
    return { kpis: [{ label: "Batches in stock", value: int(rows.length) }, { label: "Expired", value: int(rows.filter((r) => r.flag === "Expired").length), tone: "bad" },
        { label: "Expiring ≤ 60 days", value: int(rows.filter((r) => r.flag.startsWith("Expires")).length), tone: "warn" }, { label: "Value at risk", value: money(sum(rows.filter((r) => r.flag), "value"), c.cur) }],
      tables: [{ title: "Batches by expiry date", rows, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "batch", label: "Batch" }, { key: "warehouse", label: "Warehouse" },
        { key: "expiry", label: "Expiry", type: "date" }, { key: "days_left", label: "Days left", type: "int" }, { key: "qty", label: "Qty", type: "num" }, { key: "value", label: "Value", type: "money" }, { key: "flag", label: "Flag" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Warehouse */
const warehouse: ModuleDef = { key: "warehouse", title: "Warehouse", sub: "Open shipments and picking, receipts and transfers in transit", reports: [
  { key: "shipments", label: "Open shipments & picking", run: async (c) => {
    const rows = await sql<any[]>`select o.sales_order, o.created_at::date::text created, o.customer, coalesce(cu.name, o.customer) name, o.requested_ship::text requested_ship, o.doc_status, o.taker
      from d365.sales_orders o left join d365.customers cu on cu.company = o.company and cu.account = o.customer where o.company = ${c.company} and o.status = 1 order by o.requested_ship`;
    const L: Record<number, string> = { 0: "To confirm", 1: "To pick", 2: "Picked – to ship", 3: "Partially shipped", 4: "Shipped – to invoice", 5: "Partially picked", 6: "Partially invoiced" };
    const today = c.asOf > new Date().toISOString().slice(0, 10) ? c.asOf : new Date().toISOString().slice(0, 10);
    for (const r of rows) { r.step = L[r.doc_status] ?? String(r.doc_status); r.late = r.requested_ship ? Math.max(0, days(today, r.requested_ship)) : null; }
    return { kpis: [{ label: "Open orders", value: int(rows.length) }, { label: "To pick", value: int(rows.filter((r) => [0, 1, 5].includes(r.doc_status)).length) },
        { label: "Picked, not shipped", value: int(rows.filter((r) => r.doc_status === 2).length) }, { label: "Past ship date", value: int(rows.filter((r) => (r.late ?? 0) > 0).length), tone: "bad" }],
      charts: [{ title: "Open orders by warehouse step", kind: "rank", data: Object.values(L).map((l) => ({ label: l, value: rows.filter((r) => r.step === l).length })).filter((x) => x.value) }],
      tables: [{ title: "Open sales orders to ship (from D365)", rows, cols: [{ key: "sales_order", label: "Order" }, { key: "created", label: "Created", type: "date" }, { key: "name", label: "Customer" },
        { key: "requested_ship", label: "Requested ship", type: "date" }, { key: "step", label: "Step" }, { key: "late", label: "Days late", type: "int", tone: "badIfPositive" }] }] };
  } },
  { key: "receipts", label: "Receipts register", demo: true, run: async (c) => {
    const rows = (await purchLines(c)).filter((r) => r.received_date && r.received_date >= c.from && r.received_date <= c.to).map((r) => ({ ...r, value: r.received_qty * r.price }));
    return { kpis: [{ label: "Receipts", value: int(rows.length) }, { label: "Received value", value: money(sum(rows, "value"), c.cur) }, { label: "Vendors", value: int(new Set(rows.map((r) => r.vendor)).size) }],
      charts: [{ title: "Received value by warehouse", kind: "rank", money: true, data: [...rows.reduce((m, r) => m.set(r.warehouse, (m.get(r.warehouse) ?? 0) + r.value), new Map<string, number>())].map(([label, value]) => ({ label, value })) }],
      tables: [{ title: "Receipts by vendor and warehouse", rows, total: { received_date: "Total", value: sum(rows, "value") }, cols: [{ key: "received_date", label: "Received", type: "date" }, { key: "purchase_order", label: "PO" },
        { key: "vendor_name", label: "Vendor" }, { key: "warehouse", label: "Warehouse" }, { key: "item_name", label: "Item" }, { key: "received_qty", label: "Qty", type: "num" }, { key: "value", label: "Value", type: "money" }] }] };
  } },
  { key: "transit", label: "Transfers in transit", run: async (c) => {
    const rows = await sql<any[]>`select transfer_order, status, from_wh, to_wh, ship_date::text from d365.transfer_orders where company = ${c.company} order by ship_date desc`;
    const L: Record<number, string> = { 0: "Created – not shipped", 1: "In transit", 2: "Received" };
    const today = new Date().toISOString().slice(0, 10);
    const open = rows.filter((r) => r.status < 2).map((r) => ({ ...r, state: L[r.status], age: r.ship_date ? days(today, r.ship_date) : null }));
    return { kpis: [{ label: "Transfer orders", value: int(rows.length) }, { label: "In transit", value: int(rows.filter((r) => r.status === 1).length), tone: "warn" }, { label: "Not shipped", value: int(rows.filter((r) => r.status === 0).length) }, { label: "Received", value: int(rows.filter((r) => r.status === 2).length), tone: "good" }],
      tables: [{ title: "Transfers not yet received (from D365)", rows: open, cols: [{ key: "transfer_order", label: "Transfer order" }, { key: "from_wh", label: "From" }, { key: "to_wh", label: "To" },
        { key: "ship_date", label: "Ship date", type: "date" }, { key: "state", label: "Status" }, { key: "age", label: "Days since ship date", type: "int", tone: "badIfPositive" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Production */
const prodRows = (c: Ctx) => sql<any[]>`select p.prod_order, p.item, p.status, p.qty::float qty, p.delivery_date::text delivery_date, p.warehouse,
    coalesce(o.qty_done,0)::float qty_done, coalesce(o.material_plan,0)::float material_plan, coalesce(o.material_actual,0)::float material_actual, o.finished_date::text finished_date
  from d365.prod_orders p left join d365.demo_prod_output o on o.company = p.company and o.prod_order = p.prod_order where p.company = ${c.company} order by p.prod_order`;
const PS: Record<number, string> = { 0: "Created", 1: "Estimated", 2: "Scheduled", 3: "Released", 4: "Started", 5: "Reported as finished", 7: "Ended" };
const production: ModuleDef = { key: "production", title: "Production", sub: "Order status, output vs plan, material consumption and late orders", reports: [
  { key: "overview", label: "Overview", demo: true, run: async (c) => {
    const rows = await prodRows(c);
    const open = rows.filter((r) => r.status < 5);
    const today = new Date().toISOString().slice(0, 10);
    const late = open.filter((r) => r.delivery_date && r.delivery_date < today);
    const fin = rows.filter((r) => r.finished_date);
    const onTime = fin.filter((r) => r.finished_date <= r.delivery_date).length;
    const months = [...new Set(fin.map((r) => r.finished_date.slice(0, 7)))].sort().slice(-12);
    return { kpis: [{ label: "Production orders", value: int(rows.length) }, { label: "Open", value: int(open.length), tone: "warn" }, { label: "Late", value: int(late.length), tone: "bad" },
        { label: "Quantity produced", value: int(sum(rows, "qty_done")) }, { label: "Finished on time", value: fin.length ? pct(onTime / fin.length) : "–" }, { label: "Ended", value: int(rows.filter((r) => r.status === 7).length), tone: "good" }],
      charts: [{ title: "Orders by status", kind: "rank", data: Object.entries(PS).map(([k, l]) => ({ label: l, value: rows.filter((r) => r.status === Number(k)).length })).filter((x) => x.value) },
        { title: "Quantity produced by month", kind: "bucket", data: months.map((m) => ({ label: mlabel(m), value: sum(fin.filter((r) => r.finished_date.startsWith(m)), "qty_done"), color: "var(--c1)" })) }] };
  } },
  { key: "status", label: "Production order status", run: async (c) => {
    const rows = (await prodRows(c)).map((r) => ({ ...r, state: PS[r.status] ?? String(r.status) }));
    return { kpis: Object.entries(PS).map(([k, l]) => ({ label: l, value: int(rows.filter((r) => r.status === Number(k)).length) })),
      tables: [{ title: "Production orders (from D365)", rows, cols: [{ key: "prod_order", label: "Order" }, { key: "item", label: "Item" }, { key: "state", label: "Status" }, { key: "qty", label: "Scheduled qty", type: "num" },
        { key: "delivery_date", label: "Delivery date", type: "date" }, { key: "warehouse", label: "Warehouse" }] }] };
  } },
  { key: "output", label: "Output vs plan", demo: true, run: async (c) => {
    const rows = (await prodRows(c)).filter((r) => r.status >= 4).map((r) => ({ ...r, state: PS[r.status], diff: r.qty_done - r.qty, yield: r.qty ? r.qty_done / r.qty : null }));
    const byItem = [...rows.reduce((m, r) => { const e = m.get(r.item) ?? { label: r.item, plan: 0, done: 0 }; e.plan += r.qty; e.done += r.qty_done; return m.set(r.item, e); }, new Map<string, any>()).values()];
    return { kpis: [{ label: "Planned", value: int(sum(rows, "qty")) }, { label: "Produced", value: int(sum(rows, "qty_done")) }, { label: "Achievement", value: sum(rows, "qty") ? pct(sum(rows, "qty_done") / sum(rows, "qty")) : "–" }],
      charts: [{ title: "Planned vs produced by item", kind: "pair", data: byItem, a: { key: "plan", name: "Planned" }, b: { key: "done", name: "Produced" } }],
      tables: [{ title: "Started and finished orders", rows, cols: [{ key: "prod_order", label: "Order" }, { key: "item", label: "Item" }, { key: "state", label: "Status" }, { key: "qty", label: "Planned", type: "num" },
        { key: "qty_done", label: "Produced", type: "num" }, { key: "diff", label: "Difference", type: "num", tone: "signed" }, { key: "yield", label: "Achieved", type: "pct" }, { key: "finished_date", label: "Finished", type: "date" }] }] };
  } },
  { key: "material", label: "Material consumption vs BOM", demo: true, run: async (c) => {
    const rows = (await prodRows(c)).filter((r) => r.status >= 4 && r.material_actual > 0).map((r) => {
      const std = r.qty ? r.material_plan * (r.qty_done / r.qty) : 0;
      return { ...r, state: PS[r.status], std, variance: r.material_actual - std, var_pct: std ? (r.material_actual - std) / std : null };
    }).sort((a, b) => (b.var_pct ?? 0) - (a.var_pct ?? 0));
    return { kpis: [{ label: "Orders", value: int(rows.length) }, { label: "Standard (BOM)", value: int(sum(rows, "std")) }, { label: "Actual", value: int(sum(rows, "material_actual")) },
        { label: "Variance", value: sum(rows, "std") ? pct(sum(rows, "variance") / sum(rows, "std")) : "–", tone: sum(rows, "variance") > 0 ? "bad" : "good" }],
      tables: [{ title: "Consumption vs BOM per order (material units)", rows, cols: [{ key: "prod_order", label: "Order" }, { key: "item", label: "Item" }, { key: "state", label: "Status" }, { key: "qty_done", label: "Produced", type: "num" },
        { key: "std", label: "BOM standard", type: "num" }, { key: "material_actual", label: "Actual", type: "num" }, { key: "variance", label: "Variance", type: "num", tone: "badIfPositive" }, { key: "var_pct", label: "Variance %", type: "pct", tone: "badIfPositive" }] }] };
  } },
  { key: "late", label: "Late production orders", run: async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = (await prodRows(c)).filter((r) => r.status < 5 && r.delivery_date && r.delivery_date < today).map((r) => ({ ...r, state: PS[r.status], late: days(today, r.delivery_date) })).sort((a, b) => b.late - a.late);
    return { kpis: [{ label: "Late orders", value: int(rows.length), tone: "bad" }, { label: "Late quantity", value: int(sum(rows, "qty")) }, { label: "Oldest", value: rows.length ? `${int(rows[0].late)} d` : "–" }],
      tables: [{ title: "Orders past their delivery date and not finished (from D365)", rows, cols: [{ key: "prod_order", label: "Order" }, { key: "item", label: "Item" }, { key: "state", label: "Status" },
        { key: "qty", label: "Qty", type: "num" }, { key: "delivery_date", label: "Delivery date", type: "date" }, { key: "late", label: "Days late", type: "int", tone: "badIfPositive" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Cash & bank (demo bank transactions) */
const cash: ModuleDef = { key: "cash", title: "Cash & bank", sub: "Bank balances, bank transactions and the 30/60/90-day cash forecast", reports: [
  { key: "balances", label: "Bank balances", demo: true, run: async (c) => {
    const bt = await bankRows(c);
    const accs = [...new Map(bt.map((b) => [b.account, b.account_name])).entries()];
    const rows = accs.map(([account, name]) => {
      const t = bt.filter((b) => b.account === account);
      const opening = sum(t.filter((b) => b.trans_date < c.from), "amount");
      const p = t.filter((b) => b.trans_date >= c.from && b.trans_date <= c.to);
      return { account, name, opening, receipts: sum(p.filter((b) => b.amount > 0), "amount"), payments: -sum(p.filter((b) => b.amount < 0), "amount"), closing: sum(t.filter((b) => b.trans_date <= c.to), "amount") };
    });
    const daysList = [...new Set(bt.filter((b) => b.trans_date >= c.from && b.trans_date <= c.to).map((b) => b.trans_date.slice(0, 7)))].sort();
    return { kpis: [{ label: "Cash & bank", value: money(sum(rows, "closing"), c.cur), note: `at ${c.to}` }, { label: "Receipts", value: money(sum(rows, "receipts"), c.cur), tone: "good" }, { label: "Payments", value: money(sum(rows, "payments"), c.cur) }, { label: "Accounts", value: int(rows.length) }],
      charts: [{ title: "Month-end balance, all accounts", kind: "bucket", money: true, data: daysList.map((m) => ({ label: mlabel(m), value: sum(bt.filter((b) => b.trans_date.slice(0, 7) <= m), "amount"), color: "var(--c1)" })) }],
      tables: [{ title: "Balance per account", rows, total: { account: "Total", opening: sum(rows, "opening"), receipts: sum(rows, "receipts"), payments: sum(rows, "payments"), closing: sum(rows, "closing") },
        cols: [{ key: "account", label: "Account" }, { key: "name", label: "Name" }, { key: "opening", label: "Opening", type: "money" }, { key: "receipts", label: "Receipts", type: "money" }, { key: "payments", label: "Payments", type: "money" }, { key: "closing", label: "Closing", type: "money" }] }] };
  } },
  { key: "transactions", label: "Bank transactions", demo: true, run: async (c) => {
    const bt = await bankRows(c);
    let run = new Map<string, number>();
    const rows = bt.filter((b) => b.trans_date <= c.to).map((b) => { const v = (run.get(b.account) ?? 0) + b.amount; run.set(b.account, v); return { ...b, deposit: b.amount > 0 ? b.amount : null, withdrawal: b.amount < 0 ? -b.amount : null, balance: v }; })
      .filter((b) => b.trans_date >= c.from).reverse();
    const byKind = [...rows.reduce((m, r) => m.set(r.kind, (m.get(r.kind) ?? 0) + Math.abs(r.amount)), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return { kpis: [{ label: "Transactions", value: int(rows.length) }, { label: "Deposits", value: money(sum(rows, "deposit"), c.cur), tone: "good" }, { label: "Withdrawals", value: money(sum(rows, "withdrawal"), c.cur) }],
      charts: [{ title: "Volume by type", kind: "rank", money: true, data: byKind }],
      tables: [{ title: "Bank transactions, newest first", rows, cols: [{ key: "trans_date", label: "Date", type: "date" }, { key: "account", label: "Account" }, { key: "kind", label: "Type" }, { key: "description", label: "Description" },
        { key: "deposit", label: "Deposit", type: "money" }, { key: "withdrawal", label: "Withdrawal", type: "money" }, { key: "balance", label: "Balance", type: "money" }] }] };
  } },
  { key: "forecast", label: "Cash forecast", demo: true, run: async (c) => {
    const [bt, ar, ap] = await seq(() => bankRows(c), () => invoicePayments({ ...c.s, from: "1900-01-01", to: c.asOf }, c.asOf), () => vendorOpen(c));
    const start = sum(bt.filter((b) => b.trans_date <= c.asOf), "amount");
    const fixed = (await sql<{ v: number }[]>`select coalesce(-avg(m),0)::float v from (select sum(amount) m from d365.demo_bank_trans where company = ${c.company} and kind in ('Payroll','Expense') group by to_char(trans_date,'YYYY-MM')) x`)[0].v;
    const H = [{ label: "0–30 days", lo: -1e9, hi: 30 }, { label: "31–60 days", lo: 31, hi: 60 }, { label: "61–90 days", lo: 61, hi: 90 }];
    // Overdue receivables are expected in the first window; open vendor invoices by due date.
    const rows = H.map((h) => {
      const inflow = sum(ar.filter((r) => r.status !== "Paid").filter((r) => { const d = -(r.days_overdue ?? 0); return d >= h.lo && d <= h.hi; }), "remaining");
      const outflow = ap.filter((r) => r.amount - r.paid > 0.005).filter((r) => { const d = days(r.due_date, c.asOf); return d >= h.lo && d <= h.hi; }).reduce((a, r) => a + r.amount - r.paid, 0);
      return { window: h.label, inflow, outflow, fixed, net: inflow - outflow - fixed };
    });
    let bal = start; for (const r of rows) { bal += r.net; (r as any).closing = bal; }
    return { kpis: [{ label: "Cash today", value: money(start, c.cur), note: `at ${c.asOf}` }, { label: "Expected in (90 d)", value: money(sum(rows, "inflow"), c.cur), tone: "good" },
        { label: "Expected out (90 d)", value: money(sum(rows, "outflow") + sum(rows, "fixed"), c.cur) }, { label: "Cash in 90 days", value: money(bal, c.cur), tone: bal < 0 ? "bad" : "good" }],
      charts: [{ title: "Inflows vs outflows", kind: "pair", money: true, data: rows.map((r) => ({ label: r.window, in: r.inflow, out: r.outflow + r.fixed })), a: { key: "out", name: "Out" }, b: { key: "in", name: "In" } }],
      tables: [{ title: "Forecast by window", sub: "receivables by due date (overdue in the first window), vendor invoices by due date, payroll and expenses at the monthly average", rows,
        cols: [{ key: "window", label: "Window" }, { key: "inflow", label: "Customer receipts", type: "money" }, { key: "outflow", label: "Vendor payments", type: "money" }, { key: "fixed", label: "Payroll & expenses", type: "money" },
          { key: "net", label: "Net", type: "money", tone: "signed" }, { key: "closing", label: "Closing cash", type: "money" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Fixed assets (demo) */
const depr = (a: any, at: string) => {
  // Straight line, monthly, from the month after acquisition, until disposal or end of life.
  const end = a.disposal_date && a.disposal_date < at ? a.disposal_date : at;
  const m = Math.max(0, (Number(end.slice(0, 4)) - Number(a.acquisition_date.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(a.acquisition_date.slice(5, 7)));
  return Math.min(a.cost - a.salvage, ((a.cost - a.salvage) / a.life_months) * Math.min(m, a.life_months));
};
const assetRows = (c: Ctx) => sql<any[]>`select asset, name, asset_group, location, acquisition_date::text, cost::float, life_months, salvage::float, disposal_date::text, disposal_amount::float from d365.demo_assets where company = ${c.company} order by asset`;
const assets: ModuleDef = { key: "assets", title: "Fixed assets", sub: "Asset register, depreciation schedule, acquisitions and disposals", reports: [
  { key: "register", label: "Fixed asset register", demo: true, run: async (c) => {
    const rows = (await assetRows(c)).filter((a) => a.acquisition_date <= c.to).map((a) => { const acc = depr(a, c.to); return { ...a, accumulated: acc, nbv: a.disposal_date && a.disposal_date <= c.to ? 0 : a.cost - acc, state: a.disposal_date && a.disposal_date <= c.to ? "Disposed" : "In use" }; });
    const live = rows.filter((r) => r.state === "In use");
    return { kpis: [{ label: "Assets in use", value: int(live.length) }, { label: "Cost", value: money(sum(live, "cost"), c.cur) }, { label: "Accumulated depreciation", value: money(sum(live, "accumulated"), c.cur) }, { label: "Net book value", value: money(sum(live, "nbv"), c.cur) }],
      charts: [{ title: "Net book value by group", kind: "rank", money: true, data: [...live.reduce((m, r) => m.set(r.asset_group, (m.get(r.asset_group) ?? 0) + r.nbv), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) }],
      tables: [{ title: `Register at ${c.to}`, rows, total: { asset: "Total", cost: sum(live, "cost"), accumulated: sum(live, "accumulated"), nbv: sum(live, "nbv") },
        cols: [{ key: "asset", label: "Asset" }, { key: "name", label: "Name" }, { key: "asset_group", label: "Group" }, { key: "location", label: "Location" }, { key: "acquisition_date", label: "Acquired", type: "date" },
          { key: "life_months", label: "Life (months)", type: "int" }, { key: "cost", label: "Cost", type: "money" }, { key: "accumulated", label: "Acc. depreciation", type: "money" }, { key: "nbv", label: "Net book value", type: "money" }, { key: "state", label: "Status" }] }] };
  } },
  { key: "depreciation", label: "Depreciation schedule", demo: true, run: async (c) => {
    const all = await assetRows(c);
    const months: string[] = []; for (let d = c.from.slice(0, 7); d <= c.to.slice(0, 7) && months.length < 24;) { months.push(d); const [y, m] = d.split("-").map(Number); d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; }
    const endOf = (m: string) => `${m}-28`;
    const prev = (m: string) => { const [y, mm] = m.split("-").map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`; };
    const rows = all.map((a) => { const r: any = { asset: a.asset, name: a.name, asset_group: a.asset_group, total: 0 }; for (const m of months) { const v = depr(a, endOf(m)) - depr(a, endOf(prev(m))); r[m] = v; r.total += v; } return r; }).filter((r) => r.total > 0.005);
    const grp = [...rows.reduce((m, r) => m.set(r.asset_group, (m.get(r.asset_group) ?? 0) + r.total), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    return { kpis: [{ label: "Depreciation in period", value: money(sum(rows, "total"), c.cur) }, { label: "Monthly average", value: money(sum(rows, "total") / Math.max(1, months.length), c.cur) }, { label: "Assets depreciating", value: int(rows.length) }],
      charts: [{ title: "Depreciation by month", kind: "bucket", money: true, data: months.map((m) => ({ label: mlabel(m), value: sum(rows, m), color: "var(--c1)" })) }, { title: "By asset group", kind: "rank", money: true, data: grp }],
      tables: [{ title: "Monthly depreciation per asset", rows, total: { asset: "Total", total: sum(rows, "total"), ...Object.fromEntries(months.map((m) => [m, sum(rows, m)])) },
        cols: [{ key: "asset", label: "Asset" }, { key: "name", label: "Name" }, { key: "asset_group", label: "Group" }, ...months.map((m) => ({ key: m, label: mlabel(m), type: "money" as const })), { key: "total", label: "Total", type: "money" }] }] };
  } },
  { key: "movements", label: "Acquisitions & disposals", demo: true, run: async (c) => {
    const all = await assetRows(c);
    const acq = all.filter((a) => a.acquisition_date >= c.from && a.acquisition_date <= c.to).map((a) => ({ ...a, kind: "Acquisition", date: a.acquisition_date, amount: a.cost, gain: null }));
    const disp = all.filter((a) => a.disposal_date && a.disposal_date >= c.from && a.disposal_date <= c.to).map((a) => { const nbv = a.cost - depr(a, a.disposal_date); return { ...a, kind: "Disposal", date: a.disposal_date, amount: a.disposal_amount, nbv, gain: a.disposal_amount - nbv }; });
    const rows = [...acq, ...disp].sort((a, b) => a.date.localeCompare(b.date));
    return { kpis: [{ label: "Acquisitions", value: money(sum(acq, "amount"), c.cur), note: `${int(acq.length)} assets` }, { label: "Disposals (proceeds)", value: money(sum(disp, "amount"), c.cur), note: `${int(disp.length)} assets` },
        { label: "Gain / loss on disposal", value: money(sum(disp, "gain"), c.cur), tone: sum(disp, "gain") < 0 ? "bad" : "good" }],
      tables: [{ title: "Additions and disposals in the period", rows, cols: [{ key: "date", label: "Date", type: "date" }, { key: "kind", label: "Movement" }, { key: "asset", label: "Asset" }, { key: "name", label: "Name" },
        { key: "asset_group", label: "Group" }, { key: "cost", label: "Cost", type: "money" }, { key: "amount", label: "Amount / proceeds", type: "money" }, { key: "nbv", label: "NBV at disposal", type: "money" }, { key: "gain", label: "Gain / loss", type: "money", tone: "signed" }] }] };
  } },
] };

/* ------------------------------------------------------------------ Sales margin (real sales, demo cost) */
const margin: ModuleDef = { key: "margin", title: "Sales margin", sub: "Sales, cost and gross profit per item and customer", reports: [
  { key: "items", label: "By item", demo: true, run: async (c) => {
    const rows = await sql<any[]>`select l.item, max(l.item_name) name, max(l.category) category, sum(l.qty)::float qty, sum(l.line_amount)::float sales,
        sum(l.qty * coalesce(i.unit_cost, l.price * 0.65))::float cost
      from d365.invoice_lines l left join d365.demo_items i on i.company = l.company and i.item = l.item
      where l.company = ${c.company} and l.invoice_date between ${c.from} and ${c.to} and l.currency = ${c.cur} group by l.item order by 5 desc`;
    for (const r of rows) { r.gp = r.sales - r.cost; r.gm = r.sales ? r.gp / r.sales : null; }
    const s = sum(rows, "sales"), g = sum(rows, "gp");
    return { kpis: [{ label: "Sales", value: money(s, c.cur) }, { label: "Cost of sales", value: money(sum(rows, "cost"), c.cur) }, { label: "Gross profit", value: money(g, c.cur), tone: "good" }, { label: "Margin", value: s ? pct(g / s) : "–" }],
      charts: [{ title: "Gross profit by item", kind: "rank", money: true, data: rows.map((r) => ({ label: r.name || r.item, value: r.gp })).sort((a, b) => b.value - a.value).slice(0, 10) }],
      tables: [{ title: "Margin per item", rows, total: { item: "Total", sales: s, cost: sum(rows, "cost"), gp: g }, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "category", label: "Category" },
        { key: "qty", label: "Qty", type: "num" }, { key: "sales", label: "Sales", type: "money" }, { key: "cost", label: "Cost", type: "money" }, { key: "gp", label: "Gross profit", type: "money", tone: "signed" }, { key: "gm", label: "Margin", type: "pct" }] }] };
  } },
  { key: "customers", label: "By customer", demo: true, run: async (c) => {
    const rows = await sql<any[]>`select h.customer account, coalesce(max(cu.name), h.customer) name, sum(l.line_amount)::float sales, sum(l.qty * coalesce(i.unit_cost, l.price * 0.65))::float cost
      from d365.invoice_lines l join d365.invoice_headers h on h.company = l.company and h.invoice = l.invoice
      left join d365.customers cu on cu.company = h.company and cu.account = h.customer left join d365.demo_items i on i.company = l.company and i.item = l.item
      where l.company = ${c.company} and l.invoice_date between ${c.from} and ${c.to} and l.currency = ${c.cur} group by h.customer order by 3 desc`;
    for (const r of rows) { r.gp = r.sales - r.cost; r.gm = r.sales ? r.gp / r.sales : null; }
    return { kpis: [{ label: "Customers", value: int(rows.length) }, { label: "Gross profit", value: money(sum(rows, "gp"), c.cur), tone: "good" }, { label: "Margin", value: sum(rows, "sales") ? pct(sum(rows, "gp") / sum(rows, "sales")) : "–" }],
      tables: [{ title: "Margin per customer", rows, total: { account: "Total", sales: sum(rows, "sales"), cost: sum(rows, "cost"), gp: sum(rows, "gp") }, cols: [{ key: "account", label: "Account" }, { key: "name", label: "Customer" },
        { key: "sales", label: "Sales", type: "money" }, { key: "cost", label: "Cost", type: "money" }, { key: "gp", label: "Gross profit", type: "money", tone: "signed" }, { key: "gm", label: "Margin", type: "pct" }] }] };
  } },
] };

export const MODULES: ModuleDef[] = [executive, receivables, purchasing, payables, inventory, warehouse, production, cash, assets, margin];
export const moduleByKey = (k: string) => MODULES.find((m) => m.key === k);
