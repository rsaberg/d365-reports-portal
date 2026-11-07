import "server-only";
import { sql } from "../db";
import type { Scope } from "../filters";
import { salesWhere, customerFilter } from "./common";
import { TRANS_TYPE_LABEL, QUOTE_STATUS, RETURN_STATUS } from "../d365/entities";

const NOITEM = sql`coalesce(nullif(item,''),'(no item)')`;

// ---------------------------------------------------------------- Sales Performance
export async function performance(s: Scope, by: "customer" | "item" | "category" | "group" | "month") {
  const w = salesWhere(s);
  const wp = salesWhere(s, s.prevFrom, s.prevTo);
  const key =
    by === "customer" ? sql`customer` : by === "item" ? NOITEM : by === "category" ? sql`coalesce(nullif(category,''),'Uncategorized')`
    : by === "group" ? sql`coalesce(nullif(cust_group,''),'(none)')` : sql`to_char(invoice_date,'YYYY-MM')`;
  const name =
    by === "customer" ? sql`coalesce(max(customer_name), customer)` : by === "item" ? sql`coalesce(nullif(max(item_name),''),'Non-stock line')` : sql`''`;
  const rows = await sql<{ key: string; name: string; invoices: number; qty: number; net: number; discount: number; prev: number }[]>`
    with c as (select ${key} as key, ${name} as name, count(distinct invoice)::int invoices, sum(qty) qty, sum(line_amount) net, sum(discount) discount
               from d365.v_sales v where ${w} group by 1),
         p as (select ${key} as key, sum(line_amount) net from d365.v_sales v where ${wp} group by 1)
    select c.*, coalesce(p.net,0) as prev from c left join p using (key) order by ${by === "month" ? sql`c.key` : sql`c.net desc`}`;
  const total = rows.reduce((a, r) => a + r.net, 0);
  return rows.map((r) => ({ ...r, share: total ? r.net / total : 0, growth: r.prev ? (r.net - r.prev) / Math.abs(r.prev) : null }));
}

// ---------------------------------------------------------------- Invoice Register
export async function invoiceRegister(s: Scope) {
  return sql<{
    invoice: string; invoice_date: string; customer: string; customer_name: string; sales_order: string; responsible_name: string;
    net: number; tax: number; total: number; discount: number; lines: number; kind: string; payment_terms: string;
  }[]>`
    select h.invoice, h.invoice_date, h.customer, coalesce(c.name, h.customer) customer_name, h.sales_order,
           coalesce(w.name, h.responsible) responsible_name, h.total_amount - h.tax_amount as net, h.tax_amount as tax, h.total_amount as total,
           h.line_discount + h.end_discount as discount, coalesce(l.n,0)::int as lines,
           case when h.total_amount < 0 then 'Credit note' else 'Invoice' end as kind, h.payment_terms
    from d365.invoice_headers h
    left join d365.customers c on c.company = h.company and c.account = h.customer
    left join d365.workers w on w.personnel_number = h.responsible
    left join (select company, invoice, count(*) n from d365.invoice_lines group by 1,2) l on l.company = h.company and l.invoice = h.invoice
    where h.company = ${s.company} and h.currency = ${s.currency} and h.invoice_date between ${s.from} and ${s.to}
      ${s.group ? sql`and c.cust_group = ${s.group}` : sql``} ${s.responsible ? sql`and h.responsible = ${s.responsible}` : sql``}
    order by h.invoice_date desc, h.invoice desc`;
}

export async function invoiceLines(s: Scope, invoice: string) {
  return sql`select line_seq, ${NOITEM} as item, item_name, category, qty, unit, price, discount, line_amount, tax, site, warehouse
    from d365.invoice_lines where company = ${s.company} and invoice = ${invoice} order by line_seq`;
}

// ---------------------------------------------------------------- Open orders
export async function openOrders(s: Scope, asOf: string) {
  const rows = await sql<{
    sales_order: string; line_seq: number; customer: string; customer_name: string; item: string; description: string; qty: number; unit: string;
    price: number; value: number; ship_date: string; days_late: number; warehouse: string; site: string; responsible_name: string; available: number | null;
  }[]>`
    select l.sales_order, l.line_seq, h.customer, coalesce(c.name, h.customer) customer_name, coalesce(nullif(l.item,''),'(no item)') as item,
           l.description, l.qty, l.unit, l.price, l.line_amount as value, coalesce(l.confirmed_ship, l.requested_ship) as ship_date,
           (${asOf}::date - coalesce(l.confirmed_ship, l.requested_ship))::int as days_late, l.warehouse, l.site,
           coalesce(w.name, h.responsible) responsible_name, oh.available
    from d365.order_lines l
    join d365.order_headers h on h.company = l.company and h.sales_order = l.sales_order
    left join d365.customers c on c.company = l.company and c.account = h.customer
    left join d365.workers w on w.personnel_number = h.responsible
    left join (select company, item, site, sum(available) available from d365.onhand group by 1,2,3) oh
           on oh.company = l.company and oh.item = l.item and oh.site = l.site
    where l.company = ${s.company} and l.currency = ${s.currency}
      ${s.responsible ? sql`and h.responsible = ${s.responsible}` : sql``} ${customerFilter(s, "h.customer")}
    order by days_late desc, l.sales_order, l.line_seq`;
  return rows;
}

// ---------------------------------------------------------------- Aging
export async function agingItems(s: Scope) {
  return sql<{ account: string; name: string; cust_group: string; credit_limit: number; payment_terms: string; voucher: string; invoice: string;
    trans_date: string; due_date: string; trans_type: number; open: number }[]>`
    select t.account, coalesce(c.name, t.account) as name, coalesce(c.cust_group,'') cust_group, coalesce(c.credit_limit,0) credit_limit,
           coalesce(c.payment_terms,'') payment_terms, t.voucher, t.invoice, t.trans_date, coalesce(t.due_date, t.trans_date) due_date,
           t.trans_type, t.amount_mst - t.settle_mst as open
    from d365.cust_trans t left join d365.customers c on c.company = t.company and c.account = t.account
    where t.company = ${s.company} and t.closed is null and t.amount_mst - t.settle_mst <> 0 ${customerFilter(s, "t.account")}`;
}
export { TRANS_TYPE_LABEL };

// ---------------------------------------------------------------- Statement & collections
export async function statementSummary(s: Scope) {
  return sql<{ account: string; name: string; opening: number; invoiced: number; collected: number; other: number; closing: number; last_payment: string | null }[]>`
    select t.account, coalesce(max(c.name), t.account) as name,
      coalesce(sum(amount_mst) filter (where trans_date < ${s.from}),0) as opening,
      coalesce(sum(amount_mst) filter (where trans_date between ${s.from} and ${s.to} and trans_type in (2,6,8)),0) as invoiced,
      -coalesce(sum(amount_mst) filter (where trans_date between ${s.from} and ${s.to} and trans_type = 15),0) as collected,
      coalesce(sum(amount_mst) filter (where trans_date between ${s.from} and ${s.to} and trans_type not in (2,6,8,15)),0) as other,
      coalesce(sum(amount_mst) filter (where trans_date <= ${s.to}),0) as closing,
      max(trans_date) filter (where trans_type = 15 and trans_date <= ${s.to}) as last_payment
    from d365.cust_trans t left join d365.customers c on c.company = t.company and c.account = t.account
    where t.company = ${s.company} ${customerFilter(s, "t.account")}
    group by t.account
    having coalesce(sum(amount_mst) filter (where trans_date <= ${s.to}),0) <> 0
        or count(*) filter (where trans_date between ${s.from} and ${s.to}) > 0
    order by closing desc`;
}
export async function statementLines(s: Scope, account: string) {
  const rows = await sql<{ trans_date: string; voucher: string; invoice: string; trans_type: number; txt: string; due_date: string; amount: number; closed: string | null }[]>`
    select trans_date, voucher, invoice, trans_type, txt, due_date, amount_mst as amount, closed
    from d365.cust_trans where company = ${s.company} and account = ${account} and trans_date between ${s.from} and ${s.to}
    ${customerFilter(s, "account")} order by trans_date, voucher`;
  const [o] = await sql<{ opening: number }[]>`select coalesce(sum(amount_mst),0) opening from d365.cust_trans where company = ${s.company} and account = ${account} and trans_date < ${s.from}`;
  let bal = o.opening;
  return { opening: o.opening, rows: rows.map((r) => ({ ...r, type: TRANS_TYPE_LABEL[r.trans_type] ?? `Type ${r.trans_type}`, debit: r.amount > 0 ? r.amount : 0, credit: r.amount < 0 ? -r.amount : 0, balance: (bal += r.amount) })) };
}
export async function collectionsByMonth(s: Scope) {
  return sql<{ m: string; invoiced: number; collected: number }[]>`
    with months as (select to_char(d,'YYYY-MM') m from generate_series(date_trunc('month', ${s.from}::date), date_trunc('month', ${s.to}::date), interval '1 month') d)
    select months.m,
      coalesce(sum(t.amount_mst) filter (where t.trans_type in (2,6,8)),0) as invoiced,
      -coalesce(sum(t.amount_mst) filter (where t.trans_type = 15),0) as collected
    from months left join d365.cust_trans t on to_char(t.trans_date,'YYYY-MM') = months.m and t.company = ${s.company} ${customerFilter(s, "t.account")}
    group by months.m order by months.m`;
}

// ---------------------------------------------------------------- Salesperson
export async function bySalesperson(s: Scope) {
  return sql<{ responsible: string; name: string; customers: number; invoices: number; net: number; discount: number; prev: number; target: number }[]>`
    with c as (select coalesce(nullif(responsible,''),'') r, max(responsible_name) n, count(distinct customer)::int customers,
                      count(distinct invoice)::int invoices, sum(line_amount) net, sum(discount) discount
               from d365.v_sales v where ${salesWhere(s)} group by 1),
         p as (select coalesce(nullif(responsible,''),'') r, sum(line_amount) net from d365.v_sales v where ${salesWhere(s, s.prevFrom, s.prevTo)} group by 1),
         t as (select personnel_number r, sum(amount) target from portal.targets
               where company = ${s.company} and month between date_trunc('month', ${s.from}::date) and ${s.to} group by 1)
    select c.r as responsible, coalesce(c.n, case when c.r = '' then 'Unassigned' else c.r end) as name, c.customers, c.invoices, c.net, c.discount,
           coalesce(p.net,0) prev, coalesce(t.target,0) target
    from c left join p using (r) left join t using (r) order by c.net desc`;
}
export async function salespersonMonthly(s: Scope) {
  return sql<{ m: string; net: number; target: number }[]>`
    with months as (select d::date d, to_char(d,'YYYY-MM') m from generate_series(date_trunc('month', ${s.from}::date), date_trunc('month', ${s.to}::date), interval '1 month') d),
         a as (select to_char(invoice_date,'YYYY-MM') m, sum(line_amount) net from d365.v_sales v where ${salesWhere(s)} group by 1),
         t as (select to_char(month,'YYYY-MM') m, sum(amount) target from portal.targets where company = ${s.company}
               ${s.responsible ? sql`and personnel_number = ${s.responsible}` : sql``} group by 1)
    select months.m, coalesce(a.net,0) net, coalesce(t.target,0) target from months left join a using (m) left join t using (m) order by months.m`;
}

// ---------------------------------------------------------------- Discounts
export async function discounts(s: Scope) {
  const w = salesWhere(s);
  const byCustomer = await sql<{ customer: string; name: string; gross: number; discount: number; net: number; lines: number; discounted_lines: number }[]>`
    select customer, coalesce(max(customer_name), customer) name, sum(line_amount + discount) gross, sum(discount) discount, sum(line_amount) net,
           count(*)::int lines, count(*) filter (where discount <> 0)::int discounted_lines
    from d365.v_sales v where ${w} group by customer order by discount desc, net desc`;
  // Price variance: invoiced unit price vs that item's average price in the period (no trade-agreement data synced yet).
  const variance = await sql<{ invoice: string; invoice_date: string; customer_name: string; item: string; item_name: string; qty: number; price: number; avg_price: number; variance: number; impact: number }[]>`
    with v as (select * from d365.v_sales v where ${w} and qty > 0 and item <> ''),
         a as (select item, sum(line_amount + discount) / nullif(sum(qty),0) avg_price, count(*) n from v group by item)
    select v.invoice, v.invoice_date, coalesce(v.customer_name, v.customer) customer_name, v.item, v.item_name, v.qty,
           (v.line_amount + v.discount) / nullif(v.qty,0) as price, a.avg_price,
           ((v.line_amount + v.discount) / nullif(v.qty,0) - a.avg_price) / nullif(a.avg_price,0) as variance,
           ((v.line_amount + v.discount) / nullif(v.qty,0) - a.avg_price) * v.qty as impact
    from v join a using (item)
    where a.n >= 3 and ((v.line_amount + v.discount) / nullif(v.qty,0) - a.avg_price) / nullif(a.avg_price,0) < -0.05
    order by impact asc limit 200`;
  return { byCustomer, variance };
}

// ---------------------------------------------------------------- Returns
export async function returns(s: Scope) {
  const orders = await sql<{ return_order: string; rma: string; customer: string; name: string; reason: string; status: string; return_status: number;
    deadline: string; total: number; lines: number; qty: number; replacement_order: string }[]>`
    select r.return_order, r.rma, r.customer, coalesce(c.name, r.customer) name, coalesce(nullif(r.reason,''),'(no reason)') reason,
           r.return_status, r.deadline, coalesce(l.value, r.total_amount) as total, coalesce(l.n,0)::int lines, coalesce(l.qty,0) qty,
           r.replacement_order, '' as status
    from d365.return_headers r
    left join d365.customers c on c.company = r.company and c.account = r.customer
    left join (select company, return_order, count(*) n, sum(abs(return_qty)) qty, sum(abs(line_amount)) value from d365.return_lines group by 1,2) l
      on l.company = r.company and l.return_order = r.return_order
    where r.company = ${s.company} and r.currency = ${s.currency} ${customerFilter(s, "r.customer")}
    order by r.return_order desc`;
  const items = await sql<{ item: string; lines: number; qty: number; value: number; disposition: string }[]>`
    select coalesce(nullif(l.item,''),'(no item)') item, count(*)::int lines, sum(abs(l.return_qty)) qty, sum(abs(l.line_amount)) value,
           string_agg(distinct nullif(l.disposition,''), ', ') disposition
    from d365.return_lines l join d365.return_headers r using (company, return_order)
    where l.company = ${s.company} and r.currency = ${s.currency} ${customerFilter(s, "r.customer")}
    group by 1 order by value desc`;
  return { orders: orders.map((o) => ({ ...o, status: RETURN_STATUS[o.return_status] ?? String(o.return_status) })), items };
}

// ---------------------------------------------------------------- Quotations
export async function quotations(s: Scope) {
  const rows = await sql<{ quotation: string; customer: string; name: string; status: number; expiry: string; requested_date: string; total: number;
    sales_order: string; responsible_name: string; lines: number }[]>`
    select q.quotation, coalesce(nullif(q.customer,''), q.prospect) customer, coalesce(c.name, nullif(q.name,''), q.customer, q.prospect) name, q.status,
           q.expiry, q.requested_date, coalesce(l.value, q.total_amount) total, q.sales_order, coalesce(w.name, q.responsible) responsible_name, coalesce(l.n,0)::int lines
    from d365.quotations q
    left join d365.customers c on c.company = q.company and c.account = q.customer
    left join d365.workers w on w.personnel_number = q.responsible
    left join (select company, quotation, count(*) n, sum(line_amount) value from d365.quotation_lines group by 1,2) l on l.company = q.company and l.quotation = q.quotation
    where q.company = ${s.company} and q.currency = ${s.currency}
      ${s.responsible ? sql`and q.responsible = ${s.responsible}` : sql``} ${customerFilter(s, "q.customer")}
    order by q.quotation desc`;
  return rows.map((r) => ({ ...r, status_label: QUOTE_STATUS[r.status] ?? String(r.status) }));
}
