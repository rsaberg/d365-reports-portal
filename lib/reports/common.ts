import "server-only";
import { sql } from "../db";
import type { Scope } from "../filters";

/** Standard filter on d365.v_sales (alias v): company, currency, period, customer group, salesperson restriction. */
export function salesWhere(s: Scope, from = s.from, to = s.to) {
  return sql`v.company = ${s.company} and v.currency = ${s.currency} and v.invoice_date between ${from} and ${to}
    ${s.group ? sql`and v.cust_group = ${s.group}` : sql``}
    ${s.responsible ? sql`and v.responsible = ${s.responsible}` : sql``}`;
}

/** Customers visible to the user (sales role: customers they have invoiced). */
export function customerFilter(s: Scope, col: string) {
  const c = sql(col);
  return sql`${s.group ? sql`and ${c} in (select account from d365.customers where company = ${s.company} and cust_group = ${s.group})` : sql``}
    ${s.responsible ? sql`and ${c} in (select customer from d365.invoice_headers where company = ${s.company} and responsible = ${s.responsible})` : sql``}`;
}

export const pct = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
