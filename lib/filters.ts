import "server-only";
import { sql } from "./db";
import type { User } from "./auth";

export interface Scope {
  company: string; companies: { company: string; name: string }[];
  from: string; to: string; prevFrom: string; prevTo: string;
  currency: string; currencies: string[]; otherCurrencyLines: number;
  /** Accounting currency of the company (receivables are in this currency). */
  mst: string;
  group: string | null; groups: string[];
  /** Sales role: only invoices/orders where this person is responsible. null = no restriction. */
  responsible: string | null;
  years: number[];
  user: User;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const shiftYear = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

export async function getScope(user: User, sp: SP): Promise<Scope> {
  const companies = user.companies.length
    ? await sql<{ company: string; name: string }[]>`select company, coalesce(name, upper(company)) as name from d365.companies where company in ${sql(user.companies)} order by company`
    : [];
  const requested = one(sp.company);
  const company = companies.find((c) => c.company === requested)?.company
    ?? companies.find((c) => c.company === process.env.DEFAULT_COMPANY)?.company ?? companies[0]?.company ?? "";

  // Years with sales activity. Default period = most recent year with at least 10% of the busiest year's lines
  // (keeps a stray late invoice from making the default period empty).
  const yearRows = await sql<{ y: number; n: number }[]>`
    select extract(year from invoice_date)::int as y, count(*)::int as n from d365.invoice_lines where company = ${company} group by 1 order by 1`;
  const years = yearRows.map((r) => r.y);
  const busiest = Math.max(0, ...yearRows.map((r) => r.n));
  const defYear = [...yearRows].reverse().find((r) => r.n >= busiest * 0.1)?.y ?? new Date().getFullYear();

  const from = isDate(one(sp.from)) ? one(sp.from)! : `${defYear}-01-01`;
  const to = isDate(one(sp.to)) ? one(sp.to)! : `${defYear}-12-31`;

  const cur = await sql<{ currency: string; n: number }[]>`
    select currency, count(*)::int as n from d365.invoice_lines where company = ${company} group by 1 order by 2 desc`;
  const [comp] = await sql<{ currency: string | null }[]>`select currency from d365.companies where company = ${company}`;
  const currencies = cur.map((c) => c.currency);
  const reqCur = one(sp.currency);
  const currency = currencies.includes(reqCur ?? "") ? reqCur! : comp?.currency && currencies.includes(comp.currency) ? comp.currency : currencies[0] ?? "";
  const otherCurrencyLines = cur.filter((c) => c.currency !== currency).reduce((a, c) => a + c.n, 0);

  const groups = (await sql<{ g: string }[]>`select distinct cust_group as g from d365.customers where company = ${company} and cust_group <> '' order by 1`).map((r) => r.g);
  const g = one(sp.group);

  return {
    company, companies, from, to, prevFrom: shiftYear(from, -1), prevTo: shiftYear(to, -1),
    currency, currencies, otherCurrencyLines, mst: comp?.currency ?? currency, group: g && groups.includes(g) ? g : null, groups,
    responsible: user.role === "sales" ? user.personnel_number ?? "__none__" : null,
    years, user,
  };
}

/** Query-string for links that keep the current filters. */
export function qs(s: Scope, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ company: s.company, from: s.from, to: s.to, currency: s.currency, ...(s.group ? { group: s.group } : {}), ...extra });
  return p.toString();
}
