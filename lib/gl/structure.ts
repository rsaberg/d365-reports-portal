import { sql } from "../db";
import { getSetting, putSetting } from "../d365/config";

/**
 * Financial statement layout, stored in portal.settings ("fs_structure") and editable in Administration.
 * The default is derived from the chart of accounts: headings are the accounts whose number ends in zeros
 * (x000000 class · xy00000 section · xyzw000 group); posting accounts belong to the deepest heading whose prefix they share.
 *
 * A statement is an ordered list of lines:
 *  - group    : sums the accounts whose number starts with one of `prefixes` (expandable to the account tree)
 *  - subtotal : sums the groups listed in `refs` (empty = every group above it in the statement)
 *  - earnings : (balance sheet) profit of the current year and unclosed prior years = all income-statement accounts
 * `sign` turns debit-positive amounts into presentation: income statement −1 (revenue positive, costs negative);
 * balance sheet +1 for assets, −1 for liabilities and equity.
 */

export type Stmt = "IS" | "BS";
export type CfClass = "operating" | "investing" | "financing" | "cash";
export interface FsLine { id: string; stmt: Stmt; label: string; kind: "group" | "subtotal" | "earnings"; prefixes?: string[]; refs?: string[]; sign: 1 | -1; cf?: CfClass }
export type Role = "revenue" | "cogs" | "cash" | "receivables" | "inventory" | "currentAssets" | "currentLiabilities" | "payables" | "equity" | "financeCost";
export const ROLES: Record<Role, string> = {
  revenue: "Revenue", cogs: "Cost of sales", cash: "Cash and banks", receivables: "Trade receivables", inventory: "Inventory",
  currentAssets: "Current assets", currentLiabilities: "Current liabilities", payables: "Trade payables", equity: "Equity", financeCost: "Finance costs",
};
export interface FsStructure { lines: FsLine[]; cf: Record<string, CfClass>; roles: Record<Role, string[]>; isClasses: string[]; updatedAt?: string }

export interface Account { account: string; name: string; type: string }
export const isHeading = (a: string) => /^\d0{6}$|^\d{2}0{5}$|^\d{4}0{3}$/.test(a);
export const isTotal = (a: string) => /9{3}$/.test(a);
/** Prefix a heading account stands for (1101000 → "1101"). */
export const headingPrefix = (a: string) => (/^\d0{6}$/.test(a) ? a[0] : /^\d{2}0{5}$/.test(a) ? a.slice(0, 2) : a.slice(0, 4));

export async function accounts(): Promise<Account[]> {
  return sql<Account[]>`select account, name, type from gl.accounts order by account`;
}

const find = (heads: Account[], re: RegExp, within: string[]) =>
  heads.filter((h) => re.test(h.name) && within.some((p) => h.account.startsWith(p))).map((h) => headingPrefix(h.account));

/** Default layout derived from the chart of accounts. */
export function defaultStructure(accts: Account[]): FsStructure {
  const heads = accts.filter((a) => isHeading(a.account) && !isTotal(a.account));
  const classes = [...new Set(accts.filter((a) => /^\d/.test(a.account)).map((a) => a.account[0]))].sort();
  // A class belongs to the balance sheet when most of its accounts are balance-sheet / equity accounts.
  const bsClasses = classes.filter((c) => {
    const inC = accts.filter((a) => a.account.startsWith(c) && !isHeading(a.account));
    return inC.filter((a) => /balance|equity|asset|liabilit/i.test(a.type)).length > inC.length / 2;
  });
  const isClasses = classes.filter((c) => !bsClasses.includes(c));
  const name = (prefix: string) => heads.find((h) => headingPrefix(h.account) === prefix)?.name ?? `Accounts ${prefix}`;
  // Sections of a class: its xy00000 headings, plus xyzw000 headings that have no section above them.
  const sections = (c: string) => {
    const l2 = heads.filter((h) => h.account.startsWith(c) && /^\d{2}0{5}$/.test(h.account) && h.account[1] !== "0").map((h) => headingPrefix(h.account));
    const l3 = heads.filter((h) => h.account.startsWith(c) && /^\d{4}0{3}$/.test(h.account) && !/^\d{2}0{5}$/.test(h.account) && !l2.some((p) => h.account.startsWith(p))).map((h) => headingPrefix(h.account));
    const all = [...l2, ...l3].sort();
    return all.length ? all : [c];
  };
  const lines: FsLine[] = [];
  const g = (stmt: Stmt, p: string, sign: 1 | -1): FsLine => ({ id: `${stmt}-${p}`, stmt, label: name(p), kind: "group", prefixes: [p], sign });

  // Balance sheet: assets class (first), then liabilities & equity with the year's earnings.
  bsClasses.forEach((c, i) => {
    const sign: 1 | -1 = i === 0 ? 1 : -1;
    const ids: string[] = [];
    for (const p of sections(c)) { const l = g("BS", p, sign); lines.push(l); ids.push(l.id); }
    if (i === bsClasses.length - 1) { lines.push({ id: "BS-earnings", stmt: "BS", label: "Profit for the year (not yet closed)", kind: "earnings", sign: -1 }); ids.push("BS-earnings"); }
    lines.push({ id: `BS-T${c}`, stmt: "BS", label: `Total ${name(c).toLowerCase()}`, kind: "subtotal", refs: ids, sign });
  });

  // Income statement: revenue class first, then cost classes, with gross / operating / net profit.
  const revClass = isClasses.find((c) => /revenue|sales|income/i.test(name(c)) && !/other|expense/i.test(name(c))) ?? isClasses[0];
  const order = [revClass, ...isClasses.filter((c) => c !== revClass)].filter(Boolean);
  let gp = false, op = false;
  order.forEach((c, i) => {
    for (const p of sections(c)) {
      lines.push(g("IS", p, -1));
      if (!gp && i > 0 && /direct|cogs|cost of (sales|goods|revenue)/i.test(name(p))) { lines.push({ id: "IS-GP", stmt: "IS", label: "Gross profit", kind: "subtotal", refs: [], sign: -1 }); gp = true; }
    }
    if (i === 0) lines.push({ id: "IS-REV", stmt: "IS", label: `Net ${name(c).toLowerCase()}`, kind: "subtotal", refs: sections(c).map((p) => `IS-${p}`), sign: -1 });
    if (i > 0 && !op && /cost|expense/i.test(name(c))) { lines.push({ id: "IS-OP", stmt: "IS", label: "Operating profit", kind: "subtotal", refs: [], sign: -1 }); op = true; }
  });
  lines.push({ id: "IS-NP", stmt: "IS", label: "Net profit", kind: "subtotal", refs: [], sign: -1 });

  // Cash-flow classes by section name; cash & banks and depreciation by group name.
  const cf: Record<string, CfClass> = {};
  for (const l of lines.filter((x) => x.stmt === "BS" && x.kind === "group")) {
    const n = l.label;
    cf[l.prefixes![0]] = /long|fixed|non.?current|invest|project/i.test(n) && l.sign === 1 ? "investing" : /equity|capital|long/i.test(n) ? "financing" : "operating";
  }
  const bsP = bsClasses;
  for (const p of find(heads, /cash|bank|treasury|petty/i, bsP.slice(0, 1))) cf[p] = "cash";
  for (const p of find(heads, /depreciation|accumulated|amorti/i, bsP.slice(0, 1))) cf[p] = "operating";
  for (const p of find(heads, /loan|borrow|overdraft|facilit/i, bsP.slice(1))) cf[p] = "financing";

  const cur = (re: RegExp, cls: string | undefined) => lines.filter((l) => l.stmt === "BS" && l.kind === "group" && cls && l.prefixes![0].startsWith(cls) && re.test(l.label) && !/long|non.?current/i.test(l.label)).flatMap((l) => l.prefixes!);
  const roles: Record<Role, string[]> = {
    revenue: revClass ? sections(revClass) : [],
    cogs: lines.filter((l) => l.stmt === "IS" && l.kind === "group" && /direct|cogs|cost of (sales|goods)/i.test(l.label)).flatMap((l) => l.prefixes!),
    cash: find(heads, /cash|bank|treasury|petty/i, bsP.slice(0, 1)),
    receivables: find(heads, /receivable|customer|clients|debtor/i, bsP.slice(0, 1)),
    inventory: find(heads, /inventor|stock/i, bsP.slice(0, 1)),
    currentAssets: cur(/current/i, bsP[0]),
    currentLiabilities: cur(/current/i, bsP[1]),
    payables: find(heads, /payable|supplier|vendor|creditor/i, bsP.slice(1)),
    equity: lines.filter((l) => l.stmt === "BS" && l.kind === "group" && /equity|capital/i.test(l.label)).flatMap((l) => l.prefixes!),
    financeCost: find(heads, /financ|interest/i, isClasses),
  };
  return { lines, cf, roles, isClasses };
}

export async function getStructure(): Promise<FsStructure> {
  const saved = await getSetting<FsStructure>("fs_structure");
  if (saved?.lines?.length) return saved;
  return defaultStructure(await accounts());
}
export async function saveStructure(s: FsStructure | null) {
  await putSetting("fs_structure", s ? { ...s, updatedAt: new Date().toISOString() } : null);
}

/** Statement line that owns an account (longest matching prefix within the statement). */
export function lineFor(s: FsStructure, account: string, stmt?: Stmt): FsLine | undefined {
  let best: FsLine | undefined, len = -1;
  for (const l of s.lines) {
    if (l.kind !== "group" || (stmt && l.stmt !== stmt)) continue;
    for (const p of l.prefixes ?? []) if (account.startsWith(p) && p.length > len) { best = l; len = p.length; }
  }
  return best;
}
/** Is the account an income-statement account? */
export const isPL = (s: FsStructure, account: string) => s.isClasses.some((c) => account.startsWith(c));
/** Cash-flow class of a balance-sheet account (longest matching prefix in the cf map). */
export function cfFor(s: FsStructure, account: string): CfClass {
  let best: CfClass = "operating", len = -1;
  for (const [p, c] of Object.entries(s.cf)) if (account.startsWith(p) && p.length > len) { best = c; len = p.length; }
  return best;
}
export const inRole = (s: FsStructure, role: Role, account: string) => (s.roles[role] ?? []).some((p) => account.startsWith(p));
