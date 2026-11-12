import "server-only";
import { sql } from "../db";
import type { Range } from "./time";

/**
 * Semantic query layer (spec §9.3, §10.1). Every measure reads its own event layer at its own date role:
 *   INVOICED  → si.invoice_line by invoice_date (Net Sales numerator = net_mst, signed, ex-VAT)
 *   ORDERED   → si.order_line by created / confirmed date
 *   DELIVERED → si.slip_line by delivery_date
 *   COLLECTED → si.ar_trans payments / si.settlement by settle date
 *   SNAPSHOTS → backlog / AR / delivered-not-invoiced computed AS OF a date, never summed across days.
 * Company is always the first predicate (tenant/company isolation); a sales user is pinned to their own salesperson.
 */

export type Dim = "territory" | "channel" | "salesperson" | "customer" | "category" | "brand" | "tier" | "warehouse" | "item";
export const DIMS: Dim[] = ["territory", "channel", "salesperson", "tier", "customer", "category", "brand", "warehouse", "item"];
export interface SiFilter { company: string; dims: Partial<Record<Dim, string[]>> }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Frag = any;
const empty = () => sql``;

/** AND-predicates for the dims a fact supports. Unsupported dims are reported so the UI can say they were not applied. */
function where(f: SiFilter, cols: Partial<Record<Dim, string>>): { frag: Frag; ignored: Dim[] } {
  const parts: Frag[] = [];
  const ignored: Dim[] = [];
  for (const d of DIMS) {
    const v = f.dims[d];
    if (!v?.length) continue;
    const col = cols[d];
    if (!col) { ignored.push(d); continue; }
    parts.push(sql`and ${sql.unsafe(col)} in ${sql(v)}`);
  }
  return { frag: parts.reduce((a, p) => sql`${a} ${p}`, empty()), ignored };
}
const IL = { territory: "il.territory", channel: "il.channel", salesperson: "il.salesperson", customer: "il.customer", category: "p.category", brand: "p.brand", tier: "c.tier", warehouse: "il.warehouse", item: "il.item" } as const;
const OL = { territory: "c.territory", channel: "ol.channel", salesperson: "ol.salesperson", customer: "ol.customer", category: "p.category", brand: "p.brand", tier: "c.tier", warehouse: "ol.warehouse", item: "ol.item" } as const;
const AR = { territory: "c.territory", channel: "c.channel", customer: "t.customer", tier: "c.tier" } as const;
export const ilWhere = (f: SiFilter) => where(f, IL);
export const olWhere = (f: SiFilter) => where(f, OL);
export const arWhere = (f: SiFilter) => where(f, AR);
const ilFrom = (f: SiFilter) => sql`si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item where il.company = ${f.company}`;
const olFrom = (f: SiFilter) => sql`si.order_line ol left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item where ol.company = ${f.company}`;

// ------------------------------------------------------------------ INVOICED layer
export interface InvAgg {
  gross: number; discount: number; net: number; tax: number; credits: number; returns: number; allowances: number;
  cogs: number | null; cogsRestated: number | null; invoices: number; creditNotes: number; customers: number; items: number;
  qty: number; qtyReturned: number; lines: number; ordersInvoiced: number; negMarginValue: number | null; salespeople: number;
  costCoverage: number; /** share of invoice lines that carry a posted cost */
  returnDocs: number; returnCogs: number | null; lowMargin: number; /** invoice documents only (before credits) */ netDocs: number;
}
/** Margin threshold for PRI-011 (configurable later in Setup → Definitions). */
export const LOW_MARGIN = 0.1;
export async function invAgg(f: SiFilter, r: Range): Promise<InvAgg> {
  const w = ilWhere(f).frag;
  const [a] = await sql<any[]>`
    select coalesce(sum(case when doc_type='invoice' then coalesce(gross_mst, gross*fx_rate) end),0) gross,
           coalesce(sum(case when doc_type='invoice' then coalesce(discount_mst, discount*fx_rate) end),0) discount,
           coalesce(sum(net_mst),0) net, coalesce(sum(tax*fx_rate),0) tax,
           coalesce(-sum(case when doc_type='credit' then net_mst end),0) credits,
           coalesce(-sum(case when credit_class='physical_return' then net_mst end),0) returns,
           coalesce(-sum(case when credit_class='commercial_credit' then net_mst end),0) allowances,
           sum(cogs_mst) cogs, sum(cogs_restated_mst) cogs_r,
           count(distinct case when doc_type='invoice' then invoice_id end)::int invoices,
           count(distinct case when doc_type='credit' then invoice_id end)::int credit_notes,
           count(distinct case when doc_type='invoice' then il.customer end)::int customers,
           count(distinct case when doc_type='invoice' then il.item end)::int items,
           count(distinct case when doc_type='invoice' then il.salesperson end)::int salespeople,
           coalesce(sum(case when doc_type='invoice' then qty end),0) qty,
           coalesce(-sum(case when credit_class='physical_return' then qty end),0) qty_ret,
           count(*)::int lines, count(distinct case when doc_type='invoice' then order_id end)::int orders_inv,
           sum(case when doc_type='invoice' and cogs_mst is not null and net_mst < cogs_mst then net_mst end) neg_margin,
           avg(case when cogs_mst is null then 0 else 1 end) cost_cov,
           count(distinct case when credit_class='physical_return' then invoice_id end)::int return_docs,
           -sum(case when credit_class='physical_return' then cogs_mst end) return_cogs,
           count(case when doc_type='invoice' and cogs_mst is not null and net_mst - cogs_mst < ${LOW_MARGIN} * net_mst then 1 end)::int low_margin,
           coalesce(sum(case when doc_type='invoice' then net_mst end),0) net_docs
    from ${ilFrom(f)} and il.invoice_date between ${r.start} and ${r.end} ${w}`;
  return {
    gross: a.gross, discount: a.discount, net: a.net, tax: a.tax, credits: a.credits, returns: a.returns, allowances: a.allowances,
    cogs: a.cogs, cogsRestated: a.cogs_r, invoices: a.invoices, creditNotes: a.credit_notes, customers: a.customers, items: a.items,
    qty: a.qty, qtyReturned: a.qty_ret, lines: a.lines, ordersInvoiced: a.orders_inv, negMarginValue: a.neg_margin ?? (a.cogs == null ? null : 0),
    salespeople: a.salespeople, costCoverage: a.cost_cov ?? 0, returnDocs: a.return_docs, returnCogs: a.return_cogs, lowMargin: a.low_margin, netDocs: a.net_docs,
  };
}

/** Daily net sales / GP series over a span (single scan; buckets are summed in JS from these atomic days → daily = monthly = yearly). */
export async function dailySeries(f: SiFilter, r: Range) {
  const w = ilWhere(f).frag;
  const rows = await sql<{ d: string; net: number; gp: number | null; qty: number; inv: number }[]>`
    select il.invoice_date d, sum(net_mst) net, sum(net_mst) - sum(cogs_mst) gp, sum(case when doc_type='invoice' then qty else 0 end) qty,
           count(distinct case when doc_type='invoice' then invoice_id end)::int inv
    from ${ilFrom(f)} and il.invoice_date between ${r.start} and ${r.end} ${w} group by 1 order by 1`;
  return new Map(rows.map((x) => [x.d, x]));
}
export function bucketSum(series: Map<string, { net: number; gp: number | null }>, r: Range) {
  let net = 0, gp = 0, hasGp = false;
  for (const [d, v] of series) if (d >= r.start && d <= r.end) { net += v.net; if (v.gp != null) { gp += v.gp; hasGp = true; } }
  return { net, gp: hasGp ? gp : null };
}

/** Group-by on the invoice fact for current and comparison ranges (ranked by current net). */
export async function invBy(f: SiFilter, dim: Dim | "month" | "doc" | "reason", cur: Range, cmp: Range | null, limit = 15) {
  const col = dim === "month" ? "to_char(il.invoice_date,'YYYY-MM')" : dim === "doc" ? "il.doc_type" : dim === "reason" ? "coalesce(il.return_reason,'–')" : IL[dim];
  const label = dim === "customer" ? "coalesce(max(c.name), il.customer)" : dim === "item" ? "coalesce(max(p.name), il.item)" : dim === "salesperson" ? "coalesce(max(sp.name), il.salesperson)" : dim === "territory" ? "coalesce(max(t.name), il.territory)" : dim === "channel" ? "coalesce(max(ch.name), il.channel)" : `max(${col})`;
  const w = ilWhere(f).frag;
  const c2 = cmp ?? { start: "1900-01-01", end: "1900-01-01" };
  const rows = await sql<any[]>`
    select ${sql.unsafe(col)} as key, ${sql.unsafe(label)} as label,
      coalesce(sum(case when il.invoice_date between ${cur.start} and ${cur.end} then net_mst end),0) cur,
      coalesce(sum(case when il.invoice_date between ${c2.start} and ${c2.end} then net_mst end),0) prev,
      sum(case when il.invoice_date between ${cur.start} and ${cur.end} then net_mst - cogs_mst end) gp,
      coalesce(sum(case when il.invoice_date between ${cur.start} and ${cur.end} and doc_type='invoice' then qty end),0) qty,
      count(distinct case when il.invoice_date between ${cur.start} and ${cur.end} and doc_type='invoice' then invoice_id end)::int invoices,
      coalesce(-sum(case when il.invoice_date between ${cur.start} and ${cur.end} and credit_class='physical_return' then net_mst end),0) returns,
      coalesce(sum(case when il.invoice_date between ${cur.start} and ${cur.end} and doc_type='invoice' then coalesce(discount_mst, discount*fx_rate) end),0) discount,
      coalesce(sum(case when il.invoice_date between ${cur.start} and ${cur.end} and doc_type='invoice' then coalesce(gross_mst, gross*fx_rate) end),0) gross
    from si.invoice_line il
      left join si.customer c on c.company = il.company and c.account = il.customer
      left join si.product p on p.company = il.company and p.item = il.item
      left join si.salesperson sp on sp.company = il.company and sp.code = il.salesperson
      left join si.territory t on t.company = il.company and t.code = il.territory
      left join si.channel ch on ch.company = il.company and ch.code = il.channel
    where il.company = ${f.company} and (il.invoice_date between ${cur.start} and ${cur.end} or il.invoice_date between ${c2.start} and ${c2.end}) ${w}
    group by 1 order by 3 desc limit ${limit}`;
  return rows.map((x) => ({ ...x, key: x.key ?? "(blank)", label: x.label ?? x.key ?? "(blank)" })) as {
    key: string; label: string; cur: number; prev: number; gp: number | null; qty: number; invoices: number; returns: number; discount: number; gross: number }[];
}

/** Invoice line grid (server-capped). */
export async function invLines(f: SiFilter, r: Range, opts: { limit?: number; docType?: string; extra?: Frag } = {}) {
  const w = ilWhere(f).frag;
  return sql<any[]>`
    select il.invoice_date, il.invoice_id, il.doc_type, il.credit_class, il.customer, c.name customer_name, il.invoice_account,
      il.order_id, il.slip_id, il.item, p.name item_name, p.category, il.qty, il.uom, il.price, il.currency, il.net, il.fx_rate,
      coalesce(il.gross_mst, il.gross*il.fx_rate) gross_mst, coalesce(il.discount_mst, il.discount*il.fx_rate) discount_mst,
      il.net_mst, il.tax*il.fx_rate tax_mst, il.cogs_mst, il.net_mst - il.cogs_mst gp,
      case when il.net_mst <> 0 and il.cogs_mst is not null then (il.net_mst - il.cogs_mst)/il.net_mst end gm,
      il.salesperson, il.territory, il.channel, il.warehouse, il.return_reason, il.original_invoice_line_key, il.source_key
    from ${ilFrom(f)} and il.invoice_date between ${r.start} and ${r.end} ${w}
      ${opts.docType ? sql`and il.doc_type = ${opts.docType}` : empty()} ${opts.extra ?? empty()}
    order by il.invoice_date desc, il.invoice_id desc limit ${opts.limit ?? 500}`;
}

// ------------------------------------------------------------------ ORDERED / DELIVERED layers
export async function ordAgg(f: SiFilter, r: Range) {
  const w = olWhere(f).frag;
  const [a] = await sql<any[]>`
    select count(distinct case when created between ${r.start} and ${r.end} then order_id end)::int orders,
      count(case when created between ${r.start} and ${r.end} then 1 end)::int lines,
      coalesce(sum(case when created between ${r.start} and ${r.end} then net_mst end),0) intake,
      count(distinct case when confirmed between ${r.start} and ${r.end} then order_id end)::int confirmed,
      coalesce(sum(case when confirmed between ${r.start} and ${r.end} then net_mst end),0) confirmed_value,
      coalesce(sum(case when cancelled_date between ${r.start} and ${r.end} then net_mst * cancelled_qty / nullif(qty,0) end),0) cancelled
    from ${olFrom(f)} ${w}`;
  return a as { orders: number; lines: number; intake: number; confirmed: number; confirmed_value: number; cancelled: number };
}

export async function delAgg(f: SiFilter, r: Range) {
  const w = olWhere(f).frag;
  const [a] = await sql<any[]>`
    select coalesce(sum(s.value_mst),0) value, coalesce(sum(s.qty),0) qty, count(distinct s.slip_id)::int slips, count(distinct s.order_id)::int orders
    from si.slip_line s join si.order_line ol on ol.company = s.company and ol.order_id = s.order_id and ol.line_no = s.line_no
      left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
    where s.company = ${f.company} and s.delivery_date between ${r.start} and ${r.end} ${w}`;
  // OTIF over order lines whose confirmed ship date falls in the range (line-level, quantity in full, cancellations excluded).
  const [o] = await sql<any[]>`
    with due as (
      select ol.order_id, ol.line_no, ol.qty - ol.cancelled_qty need, ol.confirmed_ship, ol.created
      from ${olFrom(f)} and ol.confirmed_ship between ${r.start} and ${r.end} and ol.qty > ol.cancelled_qty ${w}),
    x as (
      select d.*, sum(s.qty) filter (where s.delivery_date <= d.confirmed_ship) ontime_qty, sum(s.qty) total_qty, min(s.delivery_date) first_date, count(s.slip_id) slips
      from due d left join si.slip_line s on s.company = ${f.company} and s.order_id = d.order_id and s.line_no = d.line_no
      group by d.order_id, d.line_no, d.need, d.confirmed_ship, d.created)
    select count(*)::int lines,
      count(*) filter (where ontime_qty >= need)::int otif,
      count(*) filter (where first_date is not null and first_date <= confirmed_ship)::int ontime,
      count(*) filter (where total_qty >= need)::int infull,
      count(*) filter (where slips > 1)::int partial,
      count(*) filter (where coalesce(total_qty,0) < need or first_date > confirmed_ship)::int late,
      avg(first_date - created)::float lead
    from x`;
  return { ...a, otifLines: o.lines, otif: o.otif, ontime: o.ontime, infull: o.infull, partial: o.partial, late: o.late, lead: o.lead } as {
    value: number; qty: number; slips: number; orders: number; otifLines: number; otif: number; ontime: number; infull: number; partial: number; late: number; lead: number | null };
}

/** Order lines open AS OF a date: ordered − delivered(≤d) − cancelled(≤d). Value at the line's net unit value. */
export async function backlogAsOf(f: SiFilter, d: string, detail = false) {
  const w = olWhere(f).frag;
  const rows = await sql<any[]>`
    with sl as (select order_id, line_no, sum(qty) q from si.slip_line where company = ${f.company} and delivery_date <= ${d} group by 1,2),
    x as (
      select ol.order_id, ol.line_no, ol.customer, c.name customer_name, ol.item, p.name item_name, ol.created, ol.confirmed_ship, ol.hold, ol.salesperson,
        ol.qty - coalesce(sl.q,0) - case when ol.cancelled_date <= ${d} then ol.cancelled_qty else 0 end open_qty,
        ol.net_mst / nullif(ol.qty,0) unit
      from si.order_line ol left join sl on sl.order_id = ol.order_id and sl.line_no = ol.line_no
        left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
      where ol.company = ${f.company} and ol.created <= ${d} ${w})
    select *, open_qty * unit open_value, ${d}::date - created age, coalesce(confirmed_ship < ${d}, false) overdue from x where open_qty > 0.000001
    ${detail ? sql`order by open_qty * unit desc limit 500` : empty()}`;
  if (detail) return { rows } as any;
  let value = 0, qty = 0, overdue = 0, holds = 0, holdValue = 0, ageW = 0;
  const buckets = [0, 0, 0, 0, 0];
  for (const r of rows) {
    value += r.open_value; qty += r.open_qty; ageW += r.age * r.open_value;
    if (r.overdue) overdue += r.open_value;
    if (r.hold) { holds++; holdValue += r.open_value; }
    buckets[r.age <= 7 ? 0 : r.age <= 14 ? 1 : r.age <= 30 ? 2 : r.age <= 60 ? 3 : 4] += r.open_value;
  }
  return { value, qty, lines: rows.length, overdue, holds, holdValue, avgAge: value ? ageW / value : null, buckets };
}

/** Delivered (slip ≤ d) but not invoiced (invoice ≤ d) value, as of d. */
export async function dniAsOf(f: SiFilter, d: string) {
  const w = olWhere(f).frag;
  const [a] = await sql<any[]>`
    with sl as (select order_id, line_no, sum(qty) q, max(delivery_date) last_slip from si.slip_line where company = ${f.company} and delivery_date <= ${d} group by 1,2),
         iv as (select order_id, order_line, sum(qty) q from si.invoice_line where company = ${f.company} and doc_type = 'invoice' and invoice_date <= ${d} group by 1,2)
    select coalesce(sum(greatest(sl.q - coalesce(iv.q,0), 0) * ol.net_mst / nullif(ol.qty,0)),0) value,
      count(*) filter (where sl.q - coalesce(iv.q,0) > 0.000001)::int lines,
      coalesce(sum(greatest(sl.q - coalesce(iv.q,0), 0) * ol.net_mst / nullif(ol.qty,0)) filter (where ${d}::date - sl.last_slip > 7),0) aged
    from si.order_line ol join sl on sl.order_id = ol.order_id and sl.line_no = ol.line_no
      left join iv on iv.order_id = ol.order_id and iv.order_line = ol.line_no
      left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
    where ol.company = ${f.company} ${w}`;
  return a as { value: number; lines: number; aged: number };
}

// ------------------------------------------------------------------ COLLECTED / AR layers
/** Settled amount per AR transaction effective at d (both sides of each settlement; reversed ones excluded once reversed). */
export const settledAsOf = (company: string, d: string) => sql`
  select trans, sum(amount) amount from (
    select debit_trans trans, amount from si.settlement where company = ${company} and settle_date <= ${d} and (reversed_date is null or reversed_date > ${d})
    union all
    select credit_trans, amount from si.settlement where company = ${company} and credit_trans is not null and settle_date <= ${d} and (reversed_date is null or reversed_date > ${d})) z
  group by trans`;
/** AR as of d. Open per document = amount − settlements effective at d (a reversed settlement reopens the invoice). */
export async function arAsOf(f: SiFilter, d: string) {
  const w = arWhere(f).frag;
  const rows = await sql<any[]>`
    with st as (${settledAsOf(f.company, d)})
    select t.doc_type, t.due_date, t.customer, t.amount - sign(t.amount) * coalesce(st.amount,0) open
    from si.ar_trans t left join st on st.trans = t.trans_id left join si.customer c on c.company = t.company and c.account = t.customer
    where t.company = ${f.company} and t.trans_date <= ${d} ${w}`;
  let open = 0, pastDue = 0, current = 0, unapplied = 0;
  const aging = [0, 0, 0, 0];
  const byCust = new Map<string, number>();
  for (const r of rows) {
    if (Math.abs(r.open) < 0.005) continue;
    open += r.open;
    byCust.set(r.customer, (byCust.get(r.customer) ?? 0) + r.open);
    if (r.open < 0) { unapplied += r.open; continue; }
    const late = Math.round((Date.parse(d) - Date.parse(r.due_date)) / 86400000);
    if (late <= 0) current += r.open; else { pastDue += r.open; aging[late <= 30 ? 0 : late <= 60 ? 1 : late <= 90 ? 2 : 3] += r.open; }
  }
  const limits = await sql<{ account: string; credit_limit: number }[]>`select account, credit_limit from si.customer where company = ${f.company} and credit_limit > 0`;
  let limitSum = 0, exposed = 0, overLimit = 0; // exposure = positive balances of customers that carry a credit limit
  for (const l of limits) { const b = byCust.get(l.account) ?? 0; limitSum += l.credit_limit; exposed += Math.max(0, b); if (b > l.credit_limit) overLimit++; }
  return { open, pastDue, current, unapplied, aging, utilization: limitSum ? exposed / limitSum : null, exposure: exposed, overLimit, byCust, ignored: arWhere(f).ignored };
}
export async function cashAgg(f: SiFilter, r: Range) {
  const w = arWhere(f).frag;
  const [a] = await sql<any[]>`
    select coalesce(-sum(case when t.doc_type in ('payment','advance') then t.amount end),0) received,
      coalesce((select sum(s.amount) from si.settlement s join si.ar_trans d on d.company = s.company and d.trans_id = s.debit_trans
                left join si.customer c on c.company = d.company and c.account = d.customer
                where s.company = ${f.company} and s.settle_date between ${r.start} and ${r.end} ${w}),0)
      - coalesce((select sum(s.amount) from si.settlement s join si.ar_trans d on d.company = s.company and d.trans_id = s.debit_trans
                left join si.customer c on c.company = d.company and c.account = d.customer
                where s.company = ${f.company} and s.reversed_date between ${r.start} and ${r.end} ${w}),0) settled,
      coalesce((select count(*) from si.settlement s join si.ar_trans d on d.company = s.company and d.trans_id = s.debit_trans
                where s.company = ${f.company} and s.settle_date between ${r.start} and ${r.end} and s.settle_date <= d.due_date),0)::int ontime,
      coalesce((select count(*) from si.settlement s where s.company = ${f.company} and s.settle_date between ${r.start} and ${r.end}),0)::int settlements
    from si.ar_trans t left join si.customer c on c.company = t.company and c.account = t.customer
    where t.company = ${f.company} and t.trans_date between ${r.start} and ${r.end} ${w}`;
  return a as { received: number; settled: number; ontime: number; settlements: number };
}

// ------------------------------------------------------------------ CUSTOMERS
export async function customerAgg(f: SiFilter, r: Range, dormantDays = 90) {
  const w = ilWhere(f).frag;
  const [a] = await sql<any[]>`
    with cur as (select il.customer, sum(net_mst) net, count(distinct invoice_id) inv
                 from ${ilFrom(f)} and il.doc_type='invoice' and il.invoice_date between ${r.start} and ${r.end} ${w} group by 1),
         hist as (select il.customer, min(il.invoice_date) first, max(il.invoice_date) filter (where il.invoice_date < ${r.start}) last_before,
                         max(il.invoice_date) filter (where il.invoice_date <= ${r.end}) last_any
                  from ${ilFrom(f)} and il.doc_type='invoice' ${w} group by 1),
         tot as (select sum(net) t from cur)
    select (select count(*) from cur)::int active,
      (select count(*) from cur join hist using (customer) where hist.first between ${r.start} and ${r.end})::int new_,
      (select count(*) from cur join hist using (customer) where hist.first < ${r.start} and ${r.start}::date - hist.last_before <= 180)::int returning_,
      (select count(*) from cur join hist using (customer) where hist.first < ${r.start} and ${r.start}::date - hist.last_before > 180)::int reactivated,
      (select count(*) from hist where ${r.end}::date - last_any > ${dormantDays} and first <= ${r.end})::int dormant,
      (select count(*) from cur where inv >= 2)::int repeaters,
      (select sum(inv) from cur)::int invoices,
      (select sum(net) from (select net from cur order by net desc limit 10) x) / nullif((select t from tot),0) top10,
      (select sum(power(net / nullif((select t from tot),0), 2)) from cur) hhi,
      (select avg(${r.end}::date - last_any) from hist where ${r.end}::date - last_any <= 365) days_since`;
  return { ...a, new: a.new_, returning: a.returning_ } as { active: number; new: number; returning: number; reactivated: number; dormant: number; repeaters: number; invoices: number; top10: number | null; hhi: number | null; days_since: number | null };
}

// ------------------------------------------------------------------ TARGETS
/** Approved target over a range; partial months are pro-rated by trading days (labelled in the UI). */
export async function targetFor(f: SiFilter, r: Range, tradingDaysFn: (a: string, b: string) => number) {
  const reps = f.dims.salesperson;
  const rows = await sql<{ month: string; amount: number }[]>`
    select month, sum(amount) amount from si.target t
    where company = ${f.company} and status = 'approved' and month between date_trunc('month', ${r.start}::date) and ${r.end}
      ${reps?.length ? sql`and salesperson in ${sql(reps)}` : empty()}
      ${f.dims.territory?.length ? sql`and salesperson in (select code from si.salesperson where company = ${f.company} and territory in ${sql(f.dims.territory)})` : empty()}
    group by 1`;
  let total = 0;
  for (const x of rows) {
    const ms = x.month, me = new Date(Date.UTC(+ms.slice(0, 4), +ms.slice(5, 7), 0)).toISOString().slice(0, 10);
    const s = r.start > ms ? r.start : ms, e = r.end < me ? r.end : me;
    if (s > e) continue;
    const full = tradingDaysFn(ms, me);
    total += full ? (x.amount * tradingDaysFn(s, e)) / full : 0;
  }
  const otherDims = (["channel", "customer", "category", "brand", "tier", "warehouse", "item"] as Dim[]).filter((d) => f.dims[d]?.length);
  return { amount: rows.length ? total : null, notComparable: otherDims };
}

// ------------------------------------------------------------------ PRICE / VOLUME / MIX (spec §10.3)
/**
 * Item-level bridge from base to current net sales (invoice docs + physical returns; commercial credits separate):
 *   Volume = (Q1tot − Q0tot) × P0avg            (matched items)
 *   Mix    = Σ P0i (Q1i − Q0i) − Volume          (matched items)
 *   Price  = Σ (P1i − P0i) Q1i                   (matched items; includes FX translation for foreign-currency lines)
 *   New    = current revenue of items not sold in base;  Lost = − base revenue of items not sold now
 *   Credits = change in commercial allowances;  Other = matched items with zero quantity on one side
 * The effects sum exactly to the total change (asserted in tests and on the Reconciliation page).
 */
export async function pvm(f: SiFilter, cur: Range, base: Range) {
  const w = ilWhere(f).frag;
  const rows = await sql<{ item: string; q0: number; r0: number; q1: number; r1: number; a0: number; a1: number }[]>`
    select il.item,
      coalesce(sum(qty) filter (where invoice_date between ${base.start} and ${base.end} and coalesce(credit_class,'') <> 'commercial_credit'),0) q0,
      coalesce(sum(net_mst) filter (where invoice_date between ${base.start} and ${base.end} and coalesce(credit_class,'') <> 'commercial_credit'),0) r0,
      coalesce(sum(qty) filter (where invoice_date between ${cur.start} and ${cur.end} and coalesce(credit_class,'') <> 'commercial_credit'),0) q1,
      coalesce(sum(net_mst) filter (where invoice_date between ${cur.start} and ${cur.end} and coalesce(credit_class,'') <> 'commercial_credit'),0) r1,
      coalesce(sum(net_mst) filter (where invoice_date between ${base.start} and ${base.end} and credit_class = 'commercial_credit'),0) a0,
      coalesce(sum(net_mst) filter (where invoice_date between ${cur.start} and ${cur.end} and credit_class = 'commercial_credit'),0) a1
    from ${ilFrom(f)} and (il.invoice_date between ${base.start} and ${base.end} or il.invoice_date between ${cur.start} and ${cur.end}) ${w}
    group by 1`;
  return pvmFrom(rows);
}
export function pvmFrom(rows: { item: string; q0: number; r0: number; q1: number; r1: number; a0: number; a1: number }[]) {
  let base = 0, current = 0, credits = 0, newItems = 0, lost = 0, other = 0, price = 0, volMix = 0, q0m = 0, q1m = 0, r0m = 0;
  const drivers: { item: string; volume: number; price: number; change: number }[] = [];
  for (const x of rows) {
    base += x.r0 + x.a0; current += x.r1 + x.a1; credits += x.a1 - x.a0;
    const has0 = Math.abs(x.q0) > 1e-9, has1 = Math.abs(x.q1) > 1e-9;
    if (has0 && has1) {
      const p0 = x.r0 / x.q0, p1 = x.r1 / x.q1;
      const v = p0 * (x.q1 - x.q0), p = (p1 - p0) * x.q1;
      volMix += v; price += p; q0m += x.q0; q1m += x.q1; r0m += x.r0;
      drivers.push({ item: x.item, volume: v, price: p, change: x.r1 - x.r0 });
    } else if (!has0 && has1 && Math.abs(x.r0) < 1e-9) newItems += x.r1;
    else if (has0 && !has1 && Math.abs(x.r1) < 1e-9) lost -= x.r0;
    else other += x.r1 - x.r0;
  }
  const volume = q0m ? (q1m - q0m) * (r0m / q0m) : 0;
  const mix = volMix - volume;
  const change = current - base;
  const residual = change - (volume + mix + price + newItems + lost + credits + other);
  drivers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return { base, current, change, volume, mix, price, newItems, lost, credits, other, residual, drivers: drivers.slice(0, 25) };
}

// ------------------------------------------------------------------ Dimension lists for the filter bar
export async function dimOptions(company: string) {
  const [terr, chan, reps, cats, brands, tiers, whs] = await Promise.all([
    sql<{ v: string; l: string }[]>`select code v, name l from si.territory where company = ${company} order by 2`,
    sql<{ v: string; l: string }[]>`select code v, name l from si.channel where company = ${company} order by 2`,
    sql<{ v: string; l: string }[]>`select code v, name l from si.salesperson where company = ${company} order by 2`,
    sql<{ v: string; l: string }[]>`select distinct category v, category l from si.product where company = ${company} and category is not null order by 1`,
    sql<{ v: string; l: string }[]>`select distinct brand v, brand l from si.product where company = ${company} and brand is not null order by 1`,
    sql<{ v: string; l: string }[]>`select distinct tier v, 'Tier ' || tier l from si.customer where company = ${company} and tier is not null order by 1`,
    sql<{ v: string; l: string }[]>`select code v, name l from si.warehouse where company = ${company} order by 2`,
  ]);
  return { territory: terr, channel: chan, salesperson: reps, category: cats, brand: brands, tier: tiers, warehouse: whs } as Record<string, { v: string; l: string }[]>;
}

/** Average days from the original sale to its physical return (RET-012). */
export async function returnLag(f: SiFilter, r: Range) {
  const w = ilWhere(f).frag;
  const [a] = await sql<{ d: number | null }[]>`
    select avg(il.invoice_date - o.invoice_date)::float d
    from si.invoice_line il join si.invoice_line o on o.company = il.company and o.invoice_line_key = il.original_invoice_line_key
      left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${f.company} and il.credit_class = 'physical_return' and il.invoice_date between ${r.start} and ${r.end} ${w}`;
  return a.d;
}
/** Net sales by fiscal year (all history) for CAGR and the multi-year chart. */
export async function netByMonth(f: SiFilter) {
  const w = ilWhere(f).frag;
  return sql<{ m: string; net: number; gp: number | null }[]>`
    select to_char(il.invoice_date,'YYYY-MM') m, sum(net_mst) net, sum(net_mst) - sum(cogs_mst) gp from ${ilFrom(f)} ${w} group by 1 order by 1`;
}
