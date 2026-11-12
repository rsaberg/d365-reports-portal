import "server-only";
import { sql } from "../db";
import { requireUser, type User } from "../auth";
import { ensureSi, DEMO_COMPANY } from "./store";
import { periodContext, type Grain, type Compare, type Basis, type CompanyCalendar, type PeriodContext } from "./time";
import { DIMS, type Dim, type SiFilter } from "./query";

export interface SiCompany { company: string; name: string; currency: string; mode: "DEMO" | "CONNECTED_D365"; data_as_of: string | null; fiscal_start_month: number; week_start: number; weekend: number[]; timezone: string }
export interface SiScope {
  user: User; companies: SiCompany[]; co: SiCompany; cal: CompanyCalendar; asOf: string; grain: Grain; compare: Compare; basis: Basis;
  pc: PeriodContext; f: SiFilter; q: Record<string, string>; pinnedRep: string | null;
}
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Companies a user may see in Sales Intelligence (row-level security, enforced in every query by `company = …`):
 *   admin → every SI company; manager/sales → their D365 companies plus the DEMO companies.
 * A sales user is additionally pinned to their own salesperson code (cannot be widened from the URL).
 */
export async function siCompanies(user: User): Promise<SiCompany[]> {
  await ensureSi();
  const all = await sql<SiCompany[]>`select company, name, currency, mode, data_as_of, fiscal_start_month, week_start, weekend, timezone from si.company where active order by mode, company`;
  return user.role === "admin" ? all : all.filter((c) => c.mode === "DEMO" || user.companies.includes(c.company));
}

export async function siScope(sp: SP, defaults: { grain?: Grain } = {}): Promise<SiScope | null> {
  const user = await requireUser();
  const companies = await siCompanies(user);
  if (!companies.length) return null;
  const co = companies.find((c) => c.company === one(sp.company)) ?? companies.find((c) => c.company === DEMO_COMPANY) ?? companies[0];
  const cal: CompanyCalendar = { fiscalStartMonth: co.fiscal_start_month, weekStart: co.week_start, weekend: co.weekend ?? [], holidays: [] };
  const hol = await sql<{ date: string }[]>`select date from si.holiday where company = ${co.company}`;
  cal.holidays = hol.map((h) => h.date);
  const today = new Date().toISOString().slice(0, 10);
  const asOf = isDate(one(sp.asOf)) ? one(sp.asOf)! : co.data_as_of && co.data_as_of < today ? co.data_as_of : today;
  const g = one(sp.g) as Grain | undefined;
  const grain: Grain = g && ["day", "week", "month", "quarter", "year"].includes(g) ? g : defaults.grain ?? "month";
  const c = one(sp.cmp) as Compare | undefined;
  const compare: Compare = c && ["prev", "ly", "none"].includes(c) ? c : "ly";
  const basis: Basis = one(sp.basis) === "trading" ? "trading" : "calendar";
  const pc = periodContext(grain, asOf, cal, compare, basis, one(sp.full) !== "1");
  const dims: SiFilter["dims"] = {};
  for (const d of DIMS) { const v = one(sp[d]); if (v) dims[d] = v.split(",").filter(Boolean).slice(0, 50); }
  const pinnedRep = user.role === "sales" ? user.personnel_number ?? "__none__" : null;
  if (pinnedRep) dims.salesperson = [pinnedRep];
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) { const x = one(v); if (x) q[k] = x; }
  return { user, companies, co, cal, asOf, grain, compare, basis, pc, f: { company: co.company, dims }, q, pinnedRep };
}

/** Href that keeps the current SI context (company, period, filters) and overrides some keys. */
export function siHref(s: SiScope, path: string, over: Record<string, string | null> = {}) {
  const keep = ["company", "asOf", "g", "cmp", "basis", "full", ...DIMS];
  const p = new URLSearchParams();
  for (const k of keep) if (s.q[k] && !(k === "salesperson" && s.pinnedRep)) p.set(k, s.q[k]);
  for (const [k, v] of Object.entries(over)) { if (v === null) p.delete(k); else p.set(k, v); }
  const t = p.toString();
  return t ? `${path}?${t}` : path;
}
export const dimLabel: Record<Dim, string> = { territory: "Territory", channel: "Channel", salesperson: "Salesperson", tier: "Tier", customer: "Customer", category: "Category", brand: "Brand", warehouse: "Warehouse", item: "Item" };
