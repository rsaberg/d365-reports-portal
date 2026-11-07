import "server-only";
import { sql } from "../db";
import type { Scope } from "../filters";
import { salesWhere, customerFilter } from "./common";

export async function dashboard(s: Scope) {
  const cur = salesWhere(s);
  const prev = salesWhere(s, s.prevFrom, s.prevTo);

  const [k] = await sql<{ net: number; invoices: number; customers: number; qty: number; discount: number }[]>`
    select coalesce(sum(line_amount),0) as net, count(distinct invoice)::int as invoices, count(distinct customer)::int as customers,
           coalesce(sum(qty),0) as qty, coalesce(sum(discount),0) as discount
    from d365.v_sales v where ${cur}`;
  const [p] = await sql<{ net: number; invoices: number; customers: number }[]>`
    select coalesce(sum(line_amount),0) as net, count(distinct invoice)::int as invoices, count(distinct customer)::int as customers
    from d365.v_sales v where ${prev}`;

  const monthly = await sql<{ m: string; cur: number; prev: number }[]>`
    with months as (
      select to_char(d, 'YYYY-MM') as m, to_char(d - interval '1 year', 'YYYY-MM') as pm
      from generate_series(date_trunc('month', ${s.from}::date), date_trunc('month', ${s.to}::date), interval '1 month') d
    ),
    c as (select to_char(invoice_date,'YYYY-MM') m, sum(line_amount) a from d365.v_sales v where ${cur} group by 1),
    pv as (select to_char(invoice_date,'YYYY-MM') m, sum(line_amount) a from d365.v_sales v where ${prev} group by 1)
    select months.m, coalesce(c.a,0) as cur, coalesce(pv.a,0) as prev
    from months left join c on c.m = months.m left join pv on pv.m = months.pm order by months.m`;

  const topCustomers = await sql<{ customer: string; name: string; net: number }[]>`
    select customer, coalesce(max(customer_name), customer) as name, sum(line_amount) as net
    from d365.v_sales v where ${cur} group by customer order by net desc limit 6`;

  const byCategory = await sql<{ category: string; net: number }[]>`
    select coalesce(nullif(category,''),'Uncategorized') as category, sum(line_amount) as net
    from d365.v_sales v where ${cur} group by 1 order by net desc`;

  const topItems = await sql<{ item: string; name: string; qty: number; net: number; prev: number }[]>`
    with c as (select item, max(item_name) n, sum(qty) q, sum(line_amount) a from d365.v_sales v where ${cur} group by item),
         pv as (select item, sum(line_amount) a from d365.v_sales v where ${prev} group by item)
    select coalesce(nullif(c.item,''),'(no item)') as item, coalesce(nullif(c.n,''),'Non-stock line') as name, c.q as qty, c.a as net, coalesce(pv.a,0) as prev
    from c left join pv using (item) order by c.a desc limit 8`;

  // Open orders (live position, not period-bound)
  const [oo] = await sql<{ lines: number; orders: number; value: number; late_value: number }[]>`
    select count(*)::int as lines, count(distinct l.sales_order)::int as orders, coalesce(sum(l.line_amount),0) as value,
           coalesce(sum(l.line_amount) filter (where coalesce(l.confirmed_ship, l.requested_ship) < current_date),0) as late_value
    from d365.order_lines l join d365.order_headers h using (company, sales_order)
    where l.company = ${s.company} and l.currency = ${s.currency}
      ${s.responsible ? sql`and h.responsible = ${s.responsible}` : sql``} ${customerFilter(s, "h.customer")}`;

  // Receivables (accounting currency) as of the end of the selected period... uses open items today.
  const [ar] = await sql<{ total: number; overdue: number; over90: number; customers: number }[]>`
    select coalesce(sum(amount_mst - settle_mst),0) as total,
           coalesce(sum(amount_mst - settle_mst) filter (where due_date < current_date),0) as overdue,
           coalesce(sum(amount_mst - settle_mst) filter (where due_date < current_date - 90),0) as over90,
           count(distinct account)::int as customers
    from d365.cust_trans t where company = ${s.company} and closed is null ${customerFilter(s, "t.account")}`;

  return { k, p, monthly, topCustomers, byCategory, topItems, oo, ar };
}
