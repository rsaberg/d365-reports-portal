import "server-only";
import { sql } from "../db";
import { requireUser, type User } from "../auth";
import { ensureGl } from "./schema";
import { getStructure, lineFor, isPL, cfFor, inRole, isHeading, headingPrefix, type FsStructure, type FsLine, type Stmt, type Role } from "./structure";

/* ============================== scope ============================== */

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const isMonth = (s?: string) => !!s && /^\d{4}-\d{2}$/.test(s);
export const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
export const addMonths = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const monthsBetween = (a: string, b: string) => { const [y1, m1] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1) + 1; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const mLabel = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const rangeLabel = (a: string, b: string) => (a === b ? mLabel(a) : a.slice(0, 4) === b.slice(0, 4) && a.slice(5) === "01" && b.slice(5) === "12" ? `FY ${a.slice(0, 4)}` : `${mLabel(a)} – ${mLabel(b)}`);

export type Compare = "py" | "pp" | "ye" | "budget" | "none";
export type View = "standard" | "trend" | "dim";
export interface FinCompany { company: string; name: string; acc_cur: string; rep_cur: string | null }
export interface FinScope {
  user: User;
  companies: FinCompany[];
  company: string; cos: string[]; consolidated: boolean;
  currency: string; currencies: string[]; accCos: string[]; repCos: string[]; excluded: string[];
  fromM: string; toM: string; years: number[]; lastMonth: string | null;
  compare: Compare; view: View; dim: string | null; dimValue: string | null; dims: string[]; by: string | null;
  s: FsStructure;
}

/** Finance pages are for administrators and managers; company access as in the rest of the portal. */
export async function finScope(sp: SP): Promise<FinScope | null> {
  const user = await requireUser();
  if (user.role === "sales") return null;
  await ensureGl();
  const all = await sql<FinCompany[]>`
    select l.company, coalesce(c.name, l.name, upper(l.company)) as name, l.acc_cur, l.rep_cur
    from gl.ledgers l left join d365.companies c on c.company = l.company
    where exists (select 1 from gl.headers h where h.company = l.company) order by l.company`;
  const companies = all.filter((c) => user.role === "admin" || user.companies.includes(c.company));
  if (!companies.length) return null;
  const req = one(sp.company);
  const company = req === "all" && companies.length > 1 ? "all" : companies.find((c) => c.company === req)?.company ?? companies[0].company;
  const consolidated = company === "all";
  const inc = consolidated ? companies : companies.filter((c) => c.company === company);

  // One company: its accounting or reporting currency. Consolidated: a currency the companies carry (the most common first).
  const carry = (cur: string) => inc.filter((c) => c.acc_cur === cur || c.rep_cur === cur).length;
  const options = consolidated
    ? [...new Set(inc.flatMap((c) => [c.acc_cur, c.rep_cur]).filter(Boolean) as string[])].sort((a, b) => carry(b) - carry(a) || a.localeCompare(b))
    : ([inc[0].acc_cur, inc[0].rep_cur].filter((x, i, a) => x && a.indexOf(x) === i) as string[]);
  const reqCur = one(sp.currency);
  const currency = reqCur && options.includes(reqCur) ? reqCur : options[0];
  const accCos = inc.filter((c) => c.acc_cur === currency).map((c) => c.company);
  const repCos = inc.filter((c) => c.acc_cur !== currency && c.rep_cur === currency).map((c) => c.company);
  const excluded = inc.filter((c) => !accCos.includes(c.company) && !repCos.includes(c.company)).map((c) => c.company);
  const cos = [...accCos, ...repCos];

  const span = await sql<{ y: number }[]>`select distinct extract(year from month)::int as y from gl.mbal where company = any(${cos}) order by 1`;
  const years = span.map((r) => r.y);
  const [lm] = await sql<{ m: string | null }[]>`select to_char(max(month), 'YYYY-MM') as m from gl.mbal where company = any(${cos}) and ptype = 'O' and month <= date_trunc('month', now())`;
  const lastMonth = lm?.m ?? null;
  const defTo = lastMonth ?? new Date().toISOString().slice(0, 7);
  const toM = isMonth(one(sp.to)) ? one(sp.to)! : defTo;
  const fromM = isMonth(one(sp.from)) && one(sp.from)! <= toM ? one(sp.from)! : `${toM.slice(0, 4)}-01`;
  const cmp = one(sp.compare) as Compare | undefined;
  const compare: Compare = cmp && ["py", "pp", "ye", "budget", "none"].includes(cmp) ? cmp : "py";
  const v = one(sp.view) as View | undefined;
  const view: View = v && ["standard", "trend", "dim"].includes(v) ? v : "standard";

  const dims = (await sql<{ k: string }[]>`select distinct jsonb_object_keys(dims) as k from gl.dimsets order by 1`).map((r) => r.k);
  const dim = one(sp.dim) && dims.includes(one(sp.dim)!) ? one(sp.dim)! : null;
  const dimValue = dim ? one(sp.dv) ?? null : null;
  const by = one(sp.by) && dims.includes(one(sp.by)!) ? one(sp.by)! : dims.includes("BUSINESSUNIT") ? "BUSINESSUNIT" : dims[0] ?? null;
  return { user, companies, company, cos, consolidated, currency, currencies: options, accCos, repCos, excluded, fromM, toM, years, lastMonth,
    compare, view, dim, dimValue, dims, by, s: await getStructure() };
}

/** Query string that keeps the finance filters. */
export function finQs(f: FinScope, extra: Record<string, string | null> = {}) {
  const p = new URLSearchParams({ company: f.company, currency: f.currency, from: f.fromM, to: f.toM, compare: f.compare });
  if (f.dim) p.set("dim", f.dim);
  if (f.dimValue) p.set("dv", f.dimValue);
  for (const [k, v] of Object.entries(extra)) (v ? p.set(k, v) : p.delete(k));
  return p.toString();
}

export async function dimValues(dim: string, cos: string[]) {
  const r = await sql<{ v: string }[]>`select distinct dims ->> ${dim} as v from gl.dimsets where dims ? ${dim} order by 1 limit 1000`;
  void cos;
  return r.map((x) => x.v).filter(Boolean);
}

/* ============================== balances ============================== */

export type Bal = Map<string, number>;
const toMap = (rows: { account: string; v: string | number }[]) => new Map(rows.map((r) => [r.account, Number(r.v)]));

/** Value in the chosen currency (debit positive): accounting amount for companies keeping their books in it, reporting amount otherwise. */
const V = (f: FinScope, a = "") => sql`case when ${sql(a + "company")} = any(${f.accCos}) then ${sql(a + "amt")} else ${sql(a + "rep")} end`;
const dimJoin = (f: FinScope) => (f.dim && f.dimValue ? sql`join gl.dimsets d on d.recid = l.dimset and d.dims ->> ${f.dim} = ${f.dimValue}` : sql``);
const useLines = (f: FinScope) => !!(f.dim && f.dimValue);

/** Income-statement movement: operating periods only (no opening or closing entries). */
export async function movement(f: FinScope, fromM: string, toM: string): Promise<Bal> {
  if (useLines(f)) return toMap(await sql`select l.account, sum(${V(f, "l.")}) as v from gl.lines l ${dimJoin(f)}
      where l.company = any(${f.cos}) and l.acc_date between ${fromM + "-01"} and ${monthEnd(toM)} and l.ptype = 'O' group by 1`);
  return toMap(await sql`select account, sum(${V(f)}) as v from gl.mbal where company = any(${f.cos}) and month between ${fromM + "-01"} and ${toM + "-01"} and ptype = 'O' group by 1`);
}

/** Monthly operating movement: Map<YYYY-MM, Bal>. */
export async function movementByMonth(f: FinScope, fromM: string, toM: string): Promise<Map<string, Bal>> {
  const rows = useLines(f)
    ? await sql<{ m: string; account: string; v: string }[]>`select to_char(l.acc_date, 'YYYY-MM') as m, l.account, sum(${V(f, "l.")}) as v from gl.lines l ${dimJoin(f)}
        where l.company = any(${f.cos}) and l.acc_date between ${fromM + "-01"} and ${monthEnd(toM)} and l.ptype = 'O' group by 1, 2`
    : await sql<{ m: string; account: string; v: string }[]>`select to_char(month, 'YYYY-MM') as m, account, sum(${V(f)}) as v from gl.mbal
        where company = any(${f.cos}) and month between ${fromM + "-01"} and ${toM + "-01"} and ptype = 'O' group by 1, 2`;
  const out = new Map<string, Bal>();
  for (const r of rows) { const b = out.get(r.m) ?? new Map(); b.set(r.account, Number(r.v)); out.set(r.m, b); }
  return out;
}

/** Balance at a month end (pre-closing): everything up to that date, without the closing entries of that fiscal year. */
export async function balance(f: FinScope, asOfM: string): Promise<Bal> {
  const ys = asOfM.slice(0, 4) + "-01-01";
  if (useLines(f)) return toMap(await sql`select l.account, sum(${V(f, "l.")}) as v from gl.lines l ${dimJoin(f)}
      where l.company = any(${f.cos}) and l.acc_date <= ${monthEnd(asOfM)} and not (l.ptype = 'C' and l.acc_date >= ${ys}) group by 1`);
  return toMap(await sql`select account, sum(${V(f)}) as v from gl.mbal where company = any(${f.cos}) and month <= ${asOfM + "-01"} and not (ptype = 'C' and month >= ${ys}) group by 1`);
}

/**
 * Trial balance for a month range: opening (before the range, after the prior year-end close and its opening entries),
 * debit and credit inside the range, closing (pre-closing balance at the end of the range). Opening + debit − credit = closing.
 */
export async function trialBalance(f: FinScope, fromM: string, toM: string) {
  const from = fromM + "-01", to = monthEnd(toM), ys = fromM.slice(0, 4) + "-01-01", ye = toM.slice(0, 4) + "-01-01";
  type R = { account: string; op: string; dr: string; cr: string };
  const DR = (a = "") => sql`case when ${sql(a + "company")} = any(${f.accCos}) then ${sql(a + "dr")} else ${sql(a + "rdr")} end`;
  const CR = (a = "") => sql`case when ${sql(a + "company")} = any(${f.accCos}) then ${sql(a + "cr")} else ${sql(a + "rcr")} end`;
  // Opening entries of the first year belong to the opening balance; closing entries of the last year are left out (pre-closing).
  const rows = useLines(f)
    ? await sql<R[]>`select l.account,
          coalesce(sum(${V(f, "l.")}) filter (where l.acc_date < ${from} or (l.ptype = 'P' and l.acc_date < ${ys}::date + interval '1 year')), 0) as op,
          coalesce(sum(greatest(${V(f, "l.")}, 0)) filter (where l.acc_date >= ${from} and not (l.ptype = 'P' and l.acc_date < ${ys}::date + interval '1 year') and not (l.ptype = 'C' and l.acc_date >= ${ye})), 0) as dr,
          coalesce(-sum(least(${V(f, "l.")}, 0)) filter (where l.acc_date >= ${from} and not (l.ptype = 'P' and l.acc_date < ${ys}::date + interval '1 year') and not (l.ptype = 'C' and l.acc_date >= ${ye})), 0) as cr
        from gl.lines l ${dimJoin(f)} where l.company = any(${f.cos}) and l.acc_date <= ${to} group by 1`
    : await sql<R[]>`select account,
          coalesce(sum(${V(f)}) filter (where month < ${from} or (ptype = 'P' and month < ${ys}::date + interval '1 year')), 0) as op,
          coalesce(sum(${DR()}) filter (where month >= ${from} and not (ptype = 'P' and month < ${ys}::date + interval '1 year') and not (ptype = 'C' and month >= ${ye})), 0) as dr,
          coalesce(sum(${CR()}) filter (where month >= ${from} and not (ptype = 'P' and month < ${ys}::date + interval '1 year') and not (ptype = 'C' and month >= ${ye})), 0) as cr
        from gl.mbal where company = any(${f.cos}) and month <= ${toM + "-01"} group by 1`;
  return rows.map((r) => { const op = Number(r.op), dr = Number(r.dr), cr = Number(r.cr); return { account: r.account, op, dr, cr, cl: op + dr - cr }; })
    .filter((r) => [r.op, r.dr, r.cr, r.cl].some((x) => Math.abs(x) >= 0.005));
}

/** Budget entered in the portal (stored debit positive, in the company's accounting currency). */
export async function budget(f: FinScope, fromM: string, toM: string): Promise<Bal> {
  return toMap(await sql`select account, sum(amount) as v from gl.budget where company = any(${f.accCos}) and month between ${fromM + "-01"} and ${toM + "-01"} group by 1`);
}
export async function budgetByMonth(f: FinScope, fromM: string, toM: string): Promise<Map<string, Bal>> {
  const rows = await sql<{ m: string; account: string; v: string }[]>`select to_char(month, 'YYYY-MM') as m, account, sum(amount) as v from gl.budget
    where company = any(${f.accCos}) and month between ${fromM + "-01"} and ${toM + "-01"} group by 1, 2`;
  const out = new Map<string, Bal>();
  for (const r of rows) { const b = out.get(r.m) ?? new Map(); b.set(r.account, Number(r.v)); out.set(r.m, b); }
  return out;
}

/** Movement (IS) or balance (BS) split by the values of one dimension: Map<value, Bal>. */
export async function byDimension(f: FinScope, stmt: Stmt, fromM: string, toM: string, dim: string) {
  const ys = toM.slice(0, 4) + "-01-01";
  const rows = stmt === "IS"
    ? await sql<{ account: string; dv: string; v: string }[]>`select l.account, coalesce(d.dims ->> ${dim}, '') as dv, sum(${V(f, "l.")}) as v
        from gl.lines l left join gl.dimsets d on d.recid = l.dimset
        where l.company = any(${f.cos}) and l.acc_date between ${fromM + "-01"} and ${monthEnd(toM)} and l.ptype = 'O' group by 1, 2`
    : await sql<{ account: string; dv: string; v: string }[]>`select l.account, coalesce(d.dims ->> ${dim}, '') as dv, sum(${V(f, "l.")}) as v
        from gl.lines l left join gl.dimsets d on d.recid = l.dimset
        where l.company = any(${f.cos}) and l.acc_date <= ${monthEnd(toM)} and not (l.ptype = 'C' and l.acc_date >= ${ys}) group by 1, 2`;
  const out = new Map<string, Bal>();
  for (const r of rows) { const m = out.get(r.dv) ?? new Map(); m.set(r.account, (m.get(r.account) ?? 0) + Number(r.v)); out.set(r.dv, m); }
  return out;
}

export async function accountNames(): Promise<Map<string, string>> {
  return new Map((await sql<{ account: string; name: string }[]>`select account, name from gl.accounts`).map((r) => [r.account, r.name]));
}

/* ============================== statements ============================== */

export interface SCol { key: string; label: string; sub?: string; kind: "value" | "variance" | "pct" | "share" }
export interface SRow { id: string; parent: string | null; depth: number; kind: "group" | "node" | "account" | "subtotal" | "earnings" | "check"; label: string; account?: string; values: (number | null)[]; children: boolean }

/** Statement rows for value columns (debit-positive balances in, presentation sign out): lines → sub-headings → accounts. */
export function buildRows(s: FsStructure, stmt: Stmt, cols: Bal[], names: Map<string, string>): SRow[] {
  const lines = s.lines.filter((l) => l.stmt === stmt);
  const n = cols.length;
  const zero = () => new Array<number>(n).fill(0);
  const raw = new Map<string, number[]>();
  const rows: SRow[] = [];
  const accts = new Set<string>(); cols.forEach((c) => c.forEach((_, a) => accts.add(a)));
  const byLine = new Map<string, string[]>();
  const unmapped: string[] = [];
  for (const a of accts) {
    if ((isPL(s, a) ? "IS" : "BS") !== stmt) continue;
    const l = lineFor(s, a, stmt);
    if (l) byLine.set(l.id, [...(byLine.get(l.id) ?? []), a]); else unmapped.push(a);
  }
  const groups: FsLine[] = [...lines];
  if (unmapped.length) {
    const um: FsLine = { id: `${stmt}-unmapped`, stmt, label: "Accounts not in the layout", kind: "group", prefixes: [], sign: stmt === "IS" ? -1 : 1 };
    byLine.set(um.id, unmapped);
    if (stmt === "IS") { const last = groups.map((g) => g.kind).lastIndexOf("subtotal"); groups.splice(last >= 0 ? last : groups.length, 0, um); }
    else groups.push(um);
  }
  const heads = new Map<string, string>();
  for (const [a, nm] of names) if (isHeading(a)) heads.set(headingPrefix(a), `${a} · ${nm}`);
  const above: string[] = [];
  for (const l of groups) {
    if (l.kind === "group") {
      const list = (byLine.get(l.id) ?? []).sort();
      const v = zero();
      for (const a of list) cols.forEach((c, i) => { v[i] += c.get(a) ?? 0; });
      raw.set(l.id, v); above.push(l.id);
      const kids: SRow[] = [];
      const nodes = new Map<string, { v: number[]; label: string; parent: string; depth: number }>();
      const base = Math.max(0, ...(l.prefixes ?? []).map((p) => p.length));
      for (const a of list) {
        let parent = l.id, depth = 1;
        for (const len of [2, 4]) {
          if (len <= base || a.length <= len || !heads.has(a.slice(0, len))) continue;
          const key = `${l.id}:${a.slice(0, len)}`;
          if (!nodes.has(key)) nodes.set(key, { v: zero(), label: heads.get(a.slice(0, len))!, parent, depth });
          const nd = nodes.get(key)!; cols.forEach((c, i) => { nd.v[i] += c.get(a) ?? 0; });
          parent = key; depth++;
        }
        const vals = cols.map((c) => (c.get(a) ?? 0) * l.sign);
        if (vals.every((x) => Math.abs(x) < 0.005)) continue;
        kids.push({ id: `${l.id}:${a}`, parent, depth, kind: "account", label: `${a} · ${names.get(a) ?? "(unknown account)"}`, account: a, values: vals, children: false });
      }
      for (const [key, nd] of nodes) if (nd.v.some((x) => Math.abs(x) >= 0.005)) kids.push({ id: key, parent: nd.parent, depth: nd.depth, kind: "node", label: nd.label, values: nd.v.map((x) => x * l.sign), children: true });
      if (!kids.length && v.every((x) => Math.abs(x) < 0.005)) continue; // empty line
      rows.push({ id: l.id, parent: null, depth: 0, kind: "group", label: l.label, values: v.map((x) => x * l.sign), children: kids.length > 0 });
      kids.sort((x, y) => x.id.slice(l.id.length + 1).localeCompare(y.id.slice(l.id.length + 1)));
      const emit = (pid: string) => { for (const r of kids) if (r.parent === pid) { rows.push(r); if (r.children) emit(r.id); } };
      emit(l.id);
    } else if (l.kind === "earnings") {
      const v = zero();
      cols.forEach((c, i) => c.forEach((x, a) => { if (isPL(s, a)) v[i] += x; }));
      raw.set(l.id, v); above.push(l.id);
      rows.push({ id: l.id, parent: null, depth: 0, kind: "earnings", label: l.label, values: v.map((x) => x * l.sign), children: false });
    } else {
      const refs = l.refs?.length ? l.refs : [...above];
      const v = zero();
      for (const r of refs) (raw.get(r) ?? []).forEach((x, i) => { v[i] += x; });
      raw.set(l.id, v);
      rows.push({ id: l.id, parent: null, depth: 0, kind: "subtotal", label: l.label, values: v.map((x) => x * l.sign), children: false });
    }
  }
  if (stmt === "BS") {
    // Debits equal credits, so every balance-sheet line plus the year's profit must net to zero.
    const v = zero();
    for (const g of groups) if (g.kind !== "subtotal") (raw.get(g.id) ?? []).forEach((x, i) => { v[i] += x; });
    if (v.some((x) => Math.abs(x) >= 1)) rows.push({ id: "BS-check", parent: null, depth: 0, kind: "check", label: "Difference (accounts outside the layout)", values: v, children: false });
  }
  return rows;
}

/** Revenue (IS) or the first balance-sheet total (total assets) per value column — base for common-size %. */
function baseRow(s: FsStructure, stmt: Stmt, rows: SRow[]) {
  if (stmt === "IS") return rows.find((r) => r.id === "IS-REV") ?? rows.find((r) => r.kind === "subtotal");
  const id = s.lines.find((l) => l.stmt === "BS" && l.kind === "subtotal")?.id;
  return rows.find((r) => r.id === id);
}

export interface StatementData { cols: SCol[]; rows: SRow[]; note?: string }

/** Assemble a statement for the page's view: standard (current vs comparison), trend (months / years) or by dimension. */
export async function statement(f: FinScope, stmt: Stmt): Promise<StatementData> {
  const names = await accountNames();
  const pl = stmt === "IS";
  const label = pl ? rangeLabel(f.fromM, f.toM) : `${mLabel(f.toM)}`;

  if (f.view === "trend") {
    const n = monthsBetween(f.fromM, f.toM);
    const yearly = n > 24;
    const keys: string[] = [];
    if (yearly) for (let y = Number(f.fromM.slice(0, 4)); y <= Number(f.toM.slice(0, 4)); y++) keys.push(String(y));
    else for (let i = 0; i < n; i++) keys.push(addMonths(f.fromM, i));
    let cols: Bal[];
    if (pl) {
      const bm = await movementByMonth(f, f.fromM, f.toM);
      cols = keys.map((k) => { const b: Bal = new Map(); for (const [m, x] of bm) if (yearly ? m.startsWith(k) : m === k) x.forEach((v, a) => b.set(a, (b.get(a) ?? 0) + v)); return b; });
      const tot: Bal = new Map(); cols.forEach((c) => c.forEach((v, a) => tot.set(a, (tot.get(a) ?? 0) + v)));
      cols.push(tot);
    } else {
      cols = await Promise.all(keys.map((k) => balance(f, yearly ? (k === f.toM.slice(0, 4) ? f.toM : `${k}-12`) : k)));
    }
    const headers: SCol[] = keys.map((k) => ({ key: k, label: yearly ? (pl ? `FY ${k}` : k === f.toM.slice(0, 4) ? mLabel(f.toM) : `Dec ${k}`) : mLabel(k), kind: "value" }));
    if (pl) headers.push({ key: "total", label: "Total", kind: "value" });
    return { cols: headers, rows: buildRows(f.s, stmt, cols, names), note: yearly ? "More than 24 months selected — shown by year." : undefined };
  }

  if (f.view === "dim" && f.by) {
    const parts = await byDimension(f, stmt, f.fromM, f.toM, f.by);
    const size = (b: Bal) => [...b].filter(([a]) => isPL(f.s, a) === pl).reduce((x, [, v]) => x + Math.abs(v), 0);
    const ranked = [...parts.entries()].filter(([k]) => k !== "").sort((a, b) => size(b[1]) - size(a[1]));
    const top = ranked.slice(0, 10);
    const rest: Bal = new Map();
    for (const [, b] of ranked.slice(10)) b.forEach((v, a) => rest.set(a, (rest.get(a) ?? 0) + v));
    const blank = parts.get("") ?? new Map();
    const cols = [...top.map(([, b]) => b), ...(rest.size ? [rest] : []), blank];
    const tot: Bal = new Map(); cols.forEach((c) => c.forEach((v, a) => tot.set(a, (tot.get(a) ?? 0) + v)));
    const headers: SCol[] = [...top.map(([k]) => ({ key: `d:${k}`, label: k, kind: "value" as const })), ...(rest.size ? [{ key: "d:other", label: `Other (${ranked.length - 10})`, kind: "value" as const }] : []),
      { key: "d:none", label: "Not set", kind: "value" }, { key: "total", label: "Total", kind: "value" }];
    return { cols: headers, rows: buildRows(f.s, stmt, [...cols, tot], names), note: `${label} by ${f.by.toLowerCase()} — top 10 values, the rest grouped.` };
  }

  // Standard: current vs comparison, variance, common-size.
  const cur = pl ? await movement(f, f.fromM, f.toM) : await balance(f, f.toM);
  const n = monthsBetween(f.fromM, f.toM);
  let cmp: Bal | null = null, cmpLabel = "";
  if (f.compare === "py") { cmp = pl ? await movement(f, addMonths(f.fromM, -12), addMonths(f.toM, -12)) : await balance(f, addMonths(f.toM, -12)); cmpLabel = pl ? rangeLabel(addMonths(f.fromM, -12), addMonths(f.toM, -12)) : mLabel(addMonths(f.toM, -12)); }
  else if (f.compare === "pp") { cmp = pl ? await movement(f, addMonths(f.fromM, -n), addMonths(f.fromM, -1)) : await balance(f, addMonths(f.fromM, -1)); cmpLabel = pl ? rangeLabel(addMonths(f.fromM, -n), addMonths(f.fromM, -1)) : mLabel(addMonths(f.fromM, -1)); }
  else if (f.compare === "ye") { const m = `${Number(f.toM.slice(0, 4)) - 1}-12`; cmp = pl ? await movement(f, `${m.slice(0, 4)}-01`, m) : await balance(f, m); cmpLabel = pl ? `FY ${m.slice(0, 4)}` : mLabel(m); }
  else if (f.compare === "budget" && pl) { cmp = await budget(f, f.fromM, f.toM); cmpLabel = "Budget"; }
  const rows = buildRows(f.s, stmt, cmp ? [cur, cmp] : [cur], names);
  const b = baseRow(f.s, stmt, rows);
  for (const r of rows) {
    const [a, c] = r.values as number[];
    const share = (x: number, i: number) => { const d = b?.values[i]; return d ? x / Math.abs(d) : null; };
    r.values = cmp
      ? [a, c, a - c, c ? (a - c) / Math.abs(c) : null, share(a, 0), share(c, 1)]
      : [a, share(a, 0)];
  }
  const shareLabel = pl ? "% of revenue" : "% of total";
  const cols: SCol[] = cmp
    ? [{ key: "cur", label, kind: "value" }, { key: "cmp", label: cmpLabel, kind: "value" }, { key: "var", label: "Change", kind: "variance" }, { key: "varp", label: "Change %", kind: "pct" },
      { key: "sh", label: shareLabel, sub: label, kind: "share" }, { key: "shc", label: shareLabel, sub: cmpLabel, kind: "share" }]
    : [{ key: "cur", label, kind: "value" }, { key: "sh", label: shareLabel, kind: "share" }];
  const note = f.compare === "budget" && !pl ? "Budget comparison applies to the income statement; balance sheet shown alone." : f.compare === "budget" && f.repCos.length ? `Budget is in accounting currency; ${f.repCos.map((c) => c.toUpperCase()).join(", ")} not included in the budget column.` : undefined;
  return { cols, rows, note };
}

/* ============================== cash flow ============================== */

/** Indirect cash flow: net profit, then the change of every non-cash balance-sheet account by its cash-flow class. */
export async function cashFlow(f: FinScope, fromM: string, toM: string, names: Map<string, string>) {
  const s = f.s;
  const [open, close] = await Promise.all([balance(f, addMonths(fromM, -1)), balance(f, toM)]);
  const np = -[...(await movement(f, fromM, toM))].filter(([a]) => isPL(s, a)).reduce((x, [, v]) => x + v, 0);
  const heads = new Map<string, string>();
  for (const [a, nm] of names) if (isHeading(a)) heads.set(headingPrefix(a), nm);
  const groups = { operating: new Map<string, number>(), investing: new Map<string, number>(), financing: new Map<string, number>() };
  let cashOpen = 0, cashClose = 0;
  const accts = new Set([...open.keys(), ...close.keys()]);
  for (const a of accts) {
    const o = open.get(a) ?? 0, c = close.get(a) ?? 0;
    if (isPL(s, a)) continue;
    const cls = cfFor(s, a);
    if (cls === "cash") { cashOpen += o; cashClose += c; continue; }
    const label = heads.get(a.slice(0, 4)) ?? heads.get(a.slice(0, 2)) ?? names.get(a) ?? a;
    groups[cls].set(label, (groups[cls].get(label) ?? 0) - (c - o));
  }
  // A year-end close inside the window moves earlier profit from income-statement accounts into retained earnings.
  // That raises equity without any cash; this line offsets it.
  const plOpen = [...open].filter(([a]) => isPL(s, a)).reduce((x, [, v]) => x + v, 0);
  const plClose = [...close].filter(([a]) => isPL(s, a)).reduce((x, [, v]) => x + v, 0);
  const closedIn = -(plClose - plOpen) - np;
  if (Math.abs(closedIn) >= 0.5) {
    const k = "Earlier profit closed to retained earnings (non-cash)";
    groups.financing.set(k, (groups.financing.get(k) ?? 0) + closedIn);
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const sortRows = (m: Map<string, number>) => [...m].filter(([, v]) => Math.abs(v) >= 0.5).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const op = np + sum(groups.operating), inv = sum(groups.investing), fin = sum(groups.financing);
  return { np, operating: sortRows(groups.operating), investing: sortRows(groups.investing), financing: sortRows(groups.financing), op, inv, fin,
    net: op + inv + fin, cashOpen, cashClose, diff: cashClose - cashOpen - (op + inv + fin) };
}

/* ============================== ratios ============================== */

export async function ratios(f: FinScope, fromM: string, toM: string) {
  const s = f.s;
  const [mv, close, open] = await Promise.all([movement(f, fromM, toM), balance(f, toM), balance(f, addMonths(fromM, -1))]);
  const role = (b: Bal, r: Role) => [...b].filter(([a]) => !isPL(s, a) && inRole(s, r, a)).reduce((x, [, v]) => x + v, 0);
  const prole = (b: Bal, r: Role) => [...b].filter(([a]) => isPL(s, a) && inRole(s, r, a)).reduce((x, [, v]) => x + v, 0);
  const firstBs = s.lines.find((l) => l.stmt === "BS" && l.kind === "subtotal");
  const assetLines = new Set(firstBs?.refs ?? []);
  const assetPrefixes = s.lines.filter((l) => assetLines.has(l.id)).flatMap((l) => l.prefixes ?? []);
  const pl = (b: Bal) => [...b].filter(([a]) => isPL(s, a)).reduce((x, [, v]) => x + v, 0);
  const days = monthsBetween(fromM, toM) * (365 / 12);
  const ann = 365 / days;
  const revenue = -prole(mv, "revenue"), cogs = prole(mv, "cogs"), np = -pl(mv), finCost = prole(mv, "financeCost");
  const gp = revenue - cogs;
  const at = (b: Bal) => {
    const assets = [...b].filter(([a]) => !isPL(s, a) && assetPrefixes.some((p) => a.startsWith(p))).reduce((x, [, v]) => x + v, 0);
    const equity = -role(b, "equity") - pl(b);
    return { assets, ca: role(b, "currentAssets"), cl: -role(b, "currentLiabilities"), cash: role(b, "cash"), inv: role(b, "inventory"), ar: role(b, "receivables"), ap: -role(b, "payables"), equity, liabilities: assets - equity };
  };
  const c = at(close), o = at(open);
  const avg = (k: keyof typeof c) => (c[k] + o[k]) / 2;
  const div = (a: number, b: number) => (b ? a / b : null);
  type Item = { k: string; v: number | null; f: "x" | "pct" | "days" | "money"; d: string; good?: "high" | "low" };
  const groups: { name: string; items: Item[] }[] = [
    { name: "Liquidity", items: [
      { k: "Current ratio", v: div(c.ca, c.cl), f: "x", d: "Current assets ÷ current liabilities", good: "high" },
      { k: "Quick ratio", v: div(c.ca - c.inv, c.cl), f: "x", d: "(Current assets − inventory) ÷ current liabilities", good: "high" },
      { k: "Cash ratio", v: div(c.cash, c.cl), f: "x", d: "Cash and banks ÷ current liabilities", good: "high" },
      { k: "Working capital", v: c.ca - c.cl, f: "money", d: "Current assets − current liabilities", good: "high" },
    ] },
    { name: "Profitability", items: [
      { k: "Gross margin", v: div(gp, revenue), f: "pct", d: "Gross profit ÷ revenue", good: "high" },
      { k: "Net margin", v: div(np, revenue), f: "pct", d: "Net profit ÷ revenue", good: "high" },
      { k: "Return on assets", v: avg("assets") ? (np / avg("assets")) * ann : null, f: "pct", d: "Net profit ÷ average total assets, annualised", good: "high" },
      { k: "Return on equity", v: avg("equity") ? (np / avg("equity")) * ann : null, f: "pct", d: "Net profit ÷ average equity, annualised", good: "high" },
    ] },
    { name: "Activity", items: [
      { k: "Asset turnover", v: avg("assets") ? (revenue / avg("assets")) * ann : null, f: "x", d: "Revenue ÷ average total assets, annualised", good: "high" },
      { k: "Days sales outstanding", v: div(avg("ar") * days, revenue), f: "days", d: "Average receivables ÷ revenue × days", good: "low" },
      { k: "Days inventory outstanding", v: div(avg("inv") * days, cogs), f: "days", d: "Average inventory ÷ cost of sales × days", good: "low" },
      { k: "Days payables outstanding", v: div(avg("ap") * days, cogs), f: "days", d: "Average payables ÷ cost of sales × days" },
      { k: "Cash conversion cycle", v: revenue && cogs ? (avg("ar") * days) / revenue + (avg("inv") * days) / cogs - (avg("ap") * days) / cogs : null, f: "days", d: "DSO + DIO − DPO", good: "low" },
    ] },
    { name: "Leverage", items: [
      { k: "Debt to equity", v: div(c.liabilities, c.equity), f: "x", d: "Total liabilities ÷ equity", good: "low" },
      { k: "Debt ratio", v: div(c.liabilities, c.assets), f: "pct", d: "Total liabilities ÷ total assets", good: "low" },
      { k: "Equity ratio", v: div(c.equity, c.assets), f: "pct", d: "Equity ÷ total assets", good: "high" },
      { k: "Interest cover", v: finCost > 0 ? (np + finCost) / finCost : null, f: "x", d: "(Net profit + finance costs) ÷ finance costs", good: "high" },
    ] },
  ];
  return { figures: { revenue, cogs, gp, np, finCost, ...c }, groups };
}

/* ============================== drill-down ============================== */

export async function accountDetail(f: FinScope, account: string, fromM: string, toM: string, dim: string | null, page: number) {
  const pl = isPL(f.s, account);
  const tb = (await trialBalance({ ...f, cos: f.cos }, fromM, toM)).find((r) => r.account === account) ?? { op: 0, dr: 0, cr: 0, cl: 0 };
  const from = fromM + "-01", to = monthEnd(toM);
  const months = await sql<{ m: string; dr: string; cr: string }[]>`
    select to_char(l.acc_date, 'YYYY-MM') as m, coalesce(sum(greatest(${V(f, "l.")}, 0)), 0) as dr, coalesce(-sum(least(${V(f, "l.")}, 0)), 0) as cr
    from gl.lines l ${dimJoin(f)} where l.company = any(${f.cos}) and l.account = ${account} and l.acc_date between ${from} and ${to} and l.ptype = 'O'
    group by 1 order by 1`;
  const byDim = dim
    ? await sql<{ dv: string; v: string; n: number }[]>`select coalesce(d2.dims ->> ${dim}, '') as dv, sum(${V(f, "l.")}) as v, count(distinct l.hdr)::int as n
        from gl.lines l ${dimJoin(f)} left join gl.dimsets d2 on d2.recid = l.dimset
        where l.company = any(${f.cos}) and l.account = ${account} and l.acc_date between ${from} and ${to} and l.ptype = 'O'
        group by 1 order by abs(sum(${V(f, "l.")})) desc limit 300`
    : [];
  const size = 200;
  const vouchers = await sql<{ hdr: string; company: string; acc_date: Date; ptype: string; voucher: string; journal: string; category: string; doc: string; v: string; dims: Record<string, string> | null }[]>`
    select l.hdr, l.company, l.acc_date, l.ptype, h.voucher, h.journal, h.category, h.doc, sum(${V(f, "l.")}) as v, (array_agg(d2.dims))[1] as dims
    from gl.lines l join gl.headers h on h.recid = l.hdr ${dimJoin(f)} left join gl.dimsets d2 on d2.recid = l.dimset
    where l.company = any(${f.cos}) and l.account = ${account} and l.acc_date between ${from} and ${to}
    group by l.hdr, l.company, l.acc_date, l.ptype, h.voucher, h.journal, h.category, h.doc
    order by l.acc_date desc, l.hdr desc limit ${size + 1} offset ${page * size}`;
  return { pl, tb, months: months.map((r) => ({ m: r.m, dr: Number(r.dr), cr: Number(r.cr) })), byDim: byDim.map((r) => ({ dv: r.dv, v: Number(r.v), n: r.n })),
    vouchers: vouchers.slice(0, size).map((r) => ({ ...r, hdr: String(r.hdr), v: Number(r.v) })), more: vouchers.length > size };
}

export async function voucherDetail(f: FinScope, hdr: string) {
  if (!/^\d+$/.test(hdr)) return null;
  const [h] = await sql<{ recid: string; company: string; acc_date: Date; ptype: string; voucher: string; journal: string; category: string; doc: string }[]>`
    select * from gl.headers where recid = ${hdr} and company = any(${f.companies.map((c) => c.company)})`;
  if (!h) return null;
  const lines = await sql<{ account: string; name: string | null; amt: string; rep: string; dims: Record<string, string> | null }[]>`
    select l.account, a.name, l.amt, l.rep, d.dims from gl.lines l left join gl.accounts a on a.account = l.account left join gl.dimsets d on d.recid = l.dimset
    where l.hdr = ${hdr} order by (l.amt < 0), l.account`;
  const others = h.voucher ? await sql<{ recid: string; acc_date: Date }[]>`select recid, acc_date from gl.headers where company = ${h.company} and voucher = ${h.voucher} and recid <> ${hdr} order by acc_date limit 20` : [];
  const [led] = await sql<{ acc_cur: string; rep_cur: string | null }[]>`select acc_cur, rep_cur from gl.ledgers where company = ${h.company}`;
  return { h: { ...h, recid: String(h.recid) }, lines: lines.map((l) => ({ ...l, amt: Number(l.amt), rep: Number(l.rep) })), others: others.map((o) => ({ ...o, recid: String(o.recid) })),
    acc_cur: led?.acc_cur ?? "", rep_cur: led?.rep_cur ?? "" };
}

/** Find vouchers by number / document across the companies the user may see. */
export async function findVouchers(f: FinScope, q: string) {
  const like = `%${q.replace(/[%_]/g, "")}%`;
  return sql<{ recid: string; company: string; acc_date: Date; voucher: string; journal: string; doc: string }[]>`
    select recid::text as recid, company, acc_date, voucher, journal, doc from gl.headers
    where company = any(${f.cos}) and (voucher ilike ${like} or doc ilike ${like} or journal ilike ${like}) order by acc_date desc limit 100`;
}
