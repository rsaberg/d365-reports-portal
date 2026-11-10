import "server-only";
import { sql } from "../db";
import type { Scope } from "../filters";
import { salesWhere, customerFilter } from "./common";
import { ensureDemo } from "./demo";

/* Sales dashboard (overview page): KPI tiles vs last year, sales and orders over time, category / region / country / city,
   top products, payment terms and methods, delivery modes, customer analysis and returns.
   Queries run one after the other (parallel queries hang on the production pooled connection). */

export interface Kpis { sales: number; orders: number; cost: number; customers: number; lines: number; returns: number }

async function kpis(s: Scope, from: string, to: string): Promise<Kpis> {
  const w = salesWhere(s, from, to);
  const [k] = await sql<Kpis[]>`
    select coalesce(sum(v.line_amount),0)::float sales, count(distinct v.invoice)::int orders,
      coalesce(sum(v.qty * coalesce(i.unit_cost, v.price * 0.65)),0)::float cost, count(distinct v.customer)::int customers, count(*)::int lines,
      coalesce(-sum(v.line_amount) filter (where v.line_amount < 0),0)::float returns
    from d365.v_sales v left join d365.demo_items i on i.company = v.company and i.item = v.item where ${w}`;
  const [r] = await sql<{ v: number }[]>`
    select coalesce(sum(l.line_amount),0)::float v from d365.return_lines l join d365.return_headers h on h.company = l.company and h.return_order = l.return_order
    where l.company = ${s.company} and coalesce(l.actual_arrival, l.expected_arrival, h.deadline) between ${from} and ${to} ${customerFilter(s, "h.customer")}`;
  k.returns += Math.abs(r.v);
  return k;
}

export async function salesDashboard(s: Scope) {
  await ensureDemo(s.company);
  const cur = salesWhere(s);
  const k = await kpis(s, s.from, s.to);
  const p = await kpis(s, s.prevFrom, s.prevTo);

  const monthly = await sql<{ m: string; sales: number; orders: number; prev: number }[]>`
    with months as (select to_char(d,'YYYY-MM') m, to_char(d - interval '1 year','YYYY-MM') pm
      from generate_series(date_trunc('month', ${s.from}::date), date_trunc('month', ${s.to}::date), interval '1 month') d),
    c as (select to_char(invoice_date,'YYYY-MM') m, sum(line_amount) a, count(distinct invoice) n from d365.v_sales v where ${cur} group by 1),
    pv as (select to_char(invoice_date,'YYYY-MM') m, sum(line_amount) a from d365.v_sales v where ${salesWhere(s, s.prevFrom, s.prevTo)} group by 1)
    select months.m, coalesce(c.a,0)::float sales, coalesce(c.n,0)::int orders, coalesce(pv.a,0)::float prev
    from months left join c on c.m = months.m left join pv on pv.m = months.pm order by months.m`;

  const byCategory = await sql<{ label: string; value: number }[]>`
    select coalesce(nullif(category,''),'Uncategorized') label, sum(line_amount)::float value from d365.v_sales v where ${cur} group by 1 order by 2 desc`;

  const byRegion = await sql<{ label: string; value: number }[]>`
    select coalesce('District ' || nullif(c.sales_district,''), 'No district') label, sum(v.line_amount)::float value
    from d365.v_sales v left join d365.customers c on c.company = v.company and c.account = v.customer where ${cur} group by 1 order by 2 desc limit 10`;

  const byCountry = await sql<{ country: string; value: number; customers: number; orders: number }[]>`
    select coalesce(nullif(c.country,''),'Unknown') country, sum(v.line_amount)::float value, count(distinct v.customer)::int customers, count(distinct v.invoice)::int orders
    from d365.v_sales v left join d365.customers c on c.company = v.company and c.account = v.customer where ${cur} group by 1 order by 2 desc limit 10`;

  const byCity = await sql<{ label: string; value: number }[]>`
    select coalesce(nullif(c.city,''),'Unknown') || coalesce(', ' || nullif(c.country,''),'') label, sum(v.line_amount)::float value
    from d365.v_sales v left join d365.customers c on c.company = v.company and c.account = v.customer where ${cur} group by 1 order by 2 desc limit 10`;

  const topProducts = await sql<{ item: string; name: string; category: string; qty: number; value: number }[]>`
    select coalesce(nullif(item,''),'(no item)') item, coalesce(max(nullif(item_name,'')), nullif(item,''), 'Non-stock lines') name, coalesce(max(nullif(category,'')),'–') category,
      sum(qty)::float qty, sum(line_amount)::float value
    from d365.v_sales v where ${cur} group by item order by 5 desc limit 10`;

  const byTerms = await sql<{ label: string; value: number }[]>`
    select coalesce(nullif(h.payment_terms,''),'Not set') label, sum(v.line_amount)::float value
    from d365.v_sales v join (select distinct on (company, invoice) company, invoice, payment_terms from d365.invoice_headers) h on h.company = v.company and h.invoice = v.invoice
    where ${cur} group by 1 order by 2 desc`;

  const byMethod = await sql<{ label: string; value: number }[]>`
    select coalesce(nullif(t.paym_mode,''),'Not set') label, (-sum(t.amount_mst))::float value
    from d365.cust_trans t where t.company = ${s.company} and t.trans_type = 15 and t.trans_date between ${s.from} and ${s.to} ${customerFilter(s, "t.account")}
    group by 1 having sum(t.amount_mst) < 0 order by 2 desc`;

  const delivery = await sql<{ mode: string; orders: number; value: number; customers: number; lines: number }[]>`
    select coalesce(nullif(h.delivery_mode,''),'Not set') mode, count(distinct v.invoice)::int orders, sum(v.line_amount)::float value,
      count(distinct v.customer)::int customers, count(*)::int lines
    from d365.v_sales v join (select distinct on (company, invoice) company, invoice, delivery_mode from d365.invoice_headers) h on h.company = v.company and h.invoice = v.invoice
    where ${cur} group by 1 order by 3 desc`;

  // Customers: new = first invoice ever falls in the period; repeat = invoiced before the period too, or more than once in it.
  const [cust] = await sql<{ total: number; new_: number; repeat: number; multi: number }[]>`
    with c as (select customer, count(distinct invoice) n from d365.v_sales v where ${cur} group by customer),
    f as (select customer, min(invoice_date) first from d365.v_sales v where v.company = ${s.company} group by customer)
    select count(*)::int total, count(*) filter (where f.first >= ${s.from})::int new_,
      count(*) filter (where f.first < ${s.from})::int repeat, count(*) filter (where c.n > 1)::int multi
    from c join f using (customer)`;
  const byGroup = await sql<{ label: string; value: number }[]>`
    select coalesce('Group ' || nullif(cust_group,''),'No group') label, sum(line_amount)::float value from d365.v_sales v where ${cur} group by 1 order by 2 desc`;
  const bySegment = await sql<{ label: string; value: number }[]>`
    select coalesce('Segment ' || nullif(c.segment,''),'No segment') label, count(distinct v.customer)::float value
    from d365.v_sales v left join d365.customers c on c.company = v.company and c.account = v.customer where ${cur} group by 1 order by 2 desc`;

  const returnsMonthly = await sql<{ m: string; returns: number }[]>`
    select to_char(coalesce(l.actual_arrival, l.expected_arrival, h.deadline),'YYYY-MM') m, sum(abs(l.line_amount))::float returns
    from d365.return_lines l join d365.return_headers h on h.company = l.company and h.return_order = l.return_order
    where l.company = ${s.company} and coalesce(l.actual_arrival, l.expected_arrival, h.deadline) between ${s.from} and ${s.to} group by 1`;
  const returnReasons = await sql<{ label: string; value: number; orders: number }[]>`
    select coalesce(nullif(reason,''),'No reason') label, count(*)::float value, count(*)::int orders from d365.return_headers where company = ${s.company} group by 1 order by 2 desc`;

  const [overview] = await sql<{ orders: number; customers: number; products: number; countries: number }[]>`
    select count(distinct invoice)::int orders, count(distinct customer)::int customers, count(distinct item)::int products,
      (select count(distinct country)::int from d365.customers where company = ${s.company} and coalesce(country,'') <> '') countries
    from d365.v_sales v where v.company = ${s.company}`;

  return { k, p, monthly, byCategory, byRegion, byCountry, byCity, topProducts, byTerms, byMethod, delivery, cust, byGroup, bySegment, returnsMonthly, returnReasons, overview };
}
