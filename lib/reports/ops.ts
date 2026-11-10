import "server-only";
import { sql } from "../db";
import type { Scope } from "../filters";
import { customerFilter } from "./common";

/* Transaction tracking: what was created, what was posted and what is still open, per module and document type.
   Sources: order / journal headers synced from D365 (d365.sales_orders, purch_orders, prod_orders, transfer_orders, journals)
   plus the posted sales invoices and customer transactions the portal already holds. */

export const SO_STATUS: Record<number, string> = { 0: "None", 1: "Open order", 2: "Delivered", 3: "Invoiced", 4: "Cancelled" };
export const SO_DOC: Record<number, string> = { 0: "Created", 1: "Confirmed", 2: "Picked", 3: "Partially delivered", 4: "Delivered", 5: "Partially picked", 6: "Partially invoiced", 7: "Invoiced" };
export const PO_STATUS: Record<number, string> = { 0: "None", 1: "Open order", 2: "Received", 3: "Invoiced", 4: "Cancelled" };
export const PO_APPROVAL: Record<number, string> = { 0: "Draft", 10: "In review", 20: "Rejected", 30: "Approved", 35: "In external review", 40: "Confirmed", 50: "Finalized" };
export const PROD_STATUS: Record<number, string> = { 0: "Created", 1: "Estimated", 2: "Scheduled", 3: "Released", 4: "Started", 5: "Reported as finished", 7: "Ended" };
export const TO_STATUS: Record<number, string> = { 0: "Created", 1: "Shipped", 2: "Received" };

export type Stage = { label: string; n: number; done?: boolean };
export interface DocType {
  key: string; module: string; name: string;
  total: number; posted: number; open: number; cancelled: number;
  /** What "posted" means for this document. */
  postedLabel: string;
  stages: Stage[];
}

export interface DocRow {
  doc: string; date: string | null; party: string; stage: string; posted: boolean; user: string; amount: number | null; age: number | null; extra?: string;
}

const days = (d: string | null, asOf: string) => (d ? Math.round((Date.parse(asOf) - Date.parse(String(d).slice(0, 10))) / 86400000) : null);
const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

/** Sales orders: synced headers plus every order that has a posted invoice (even when the header is no longer synced). */
async function salesOrders(company: string) {
  return sql<{ sales_order: string; created: string | null; status: number; doc_status: number; taker: string; customer: string; invoiced: boolean; inv_amount: number; last_invoice: string | null; responsible: string }[]>`
    with inv as (
      select sales_order, sum(total_amount) amt, max(invoice_date) last_inv, min(invoice_date) first_inv, max(customer) customer, max(responsible) responsible
      from d365.invoice_headers where company = ${company} and coalesce(sales_order,'') <> '' group by sales_order)
    select coalesce(o.sales_order, i.sales_order) sales_order, coalesce(o.created_at::date, i.first_inv) created,
           coalesce(o.status, 3) status, coalesce(o.doc_status, 7) doc_status, coalesce(o.taker, i.responsible, '') taker,
           coalesce(o.customer, i.customer, '') customer, (coalesce(o.status, 3) = 3 or i.sales_order is not null) invoiced,
           coalesce(i.amt, 0)::float inv_amount, i.last_inv last_invoice, coalesce(i.responsible, '') responsible
    from (select * from d365.sales_orders where company = ${company}) o full join inv i on i.sales_order = o.sales_order`;
}

export async function documentTypes(company: string): Promise<DocType[]> {
  // One query at a time: keeps this page to a single pooled connection.
  const so = await salesOrders(company);
  const [po, prod, tos, jr] = [
    await sql<{ status: number; approval: number; n: number }[]>`select status, approval, count(*)::int n from d365.purch_orders where company = ${company} group by 1,2`,
    await sql<{ status: number; n: number }[]>`select status, count(*)::int n from d365.prod_orders where company = ${company} group by 1`,
    await sql<{ status: number; n: number }[]>`select status, count(*)::int n from d365.transfer_orders where company = ${company} group by 1`,
    await journalSummary(company),
  ] as const;
  const out: DocType[] = [];

  // Sales orders: created → confirmed → picked → delivered → invoiced
  {
    const inv = so.filter((r) => r.status === 3 || (r.invoiced && r.status !== 4)).length;
    const canc = so.filter((r) => r.status === 4).length;
    const open = so.length - inv - canc;
    const at = (k: number[]) => so.filter((r) => r.status === 1 && k.includes(r.doc_status)).length;
    out.push({ key: "so", module: "Sales", name: "Sales orders", total: so.length, posted: inv, open, cancelled: canc, postedLabel: "Invoiced",
      stages: [{ label: "Open – not confirmed", n: at([0]) }, { label: "Confirmed", n: at([1]) }, { label: "Picked", n: at([2, 5]) },
        { label: "Partially delivered", n: at([3]) }, { label: "Delivered, not invoiced", n: so.filter((r) => r.status === 2 || (r.status === 1 && r.doc_status === 4)).length },
        { label: "Partially invoiced", n: at([6]) }, { label: "Invoiced", n: inv, done: true }, { label: "Cancelled", n: canc }] });
  }
  // Purchase orders: draft → in review → approved → confirmed → received → invoiced
  {
    const n = (f: (r: { status: number; approval: number }) => boolean) => po.filter(f).reduce((a, r) => a + r.n, 0);
    const total = n(() => true), inv = n((r) => r.status === 3), canc = n((r) => r.status === 4);
    out.push({ key: "po", module: "Procurement", name: "Purchase orders", total, posted: inv, open: total - inv - canc, cancelled: canc, postedLabel: "Invoiced",
      stages: [{ label: "Draft", n: n((r) => r.status === 1 && r.approval === 0) }, { label: "In review", n: n((r) => r.status === 1 && [10, 35].includes(r.approval)) },
        { label: "Rejected", n: n((r) => r.status === 1 && r.approval === 20) }, { label: "Approved, not confirmed", n: n((r) => r.status === 1 && r.approval === 30) },
        { label: "Confirmed, not received", n: n((r) => r.status === 1 && r.approval >= 40) }, { label: "Received, not invoiced", n: n((r) => r.status === 2) },
        { label: "Invoiced", n: inv, done: true }, { label: "Cancelled", n: canc }] });
  }
  // Production orders
  {
    const n = (k: number[]) => prod.filter((r) => k.includes(r.status)).reduce((a, r) => a + r.n, 0);
    const total = n([0, 1, 2, 3, 4, 5, 7]), ended = n([7]);
    out.push({ key: "prod", module: "Production", name: "Production orders", total, posted: ended, open: total - ended, cancelled: 0, postedLabel: "Ended (costed)",
      stages: [0, 1, 2, 3, 4, 5, 7].map((k) => ({ label: PROD_STATUS[k], n: n([k]), done: k === 7 }))});
  }
  // Transfer orders
  {
    const n = (k: number) => tos.find((r) => r.status === k)?.n ?? 0;
    const total = n(0) + n(1) + n(2);
    out.push({ key: "to", module: "Inventory", name: "Transfer orders", total, posted: n(2), open: n(0) + n(1), cancelled: 0, postedLabel: "Received",
      stages: [{ label: "Created, not shipped", n: n(0) }, { label: "Shipped, not received", n: n(1) }, { label: "Received", n: n(2), done: true }] });
  }
  // Journals of every module
  for (const j of jr) {
    out.push({ key: `j:${j.source}`, module: j.module, name: j.kind + "s", total: j.total, posted: j.posted, open: j.total - j.posted, cancelled: 0, postedLabel: "Posted",
      stages: [{ label: "Not posted", n: j.total - j.posted }, { label: "Posted", n: j.posted, done: true }] });
  }
  return out;
}

/** Journal headers by source. General journals exclude batches that also come in through a payment-journal entity. */
export async function journalSummary(company: string) {
  return sql<{ source: string; module: string; kind: string; total: number; posted: number }[]>`
    select source, module, kind, count(*)::int total, count(*) filter (where posted = 1)::int posted
    from d365.journals j where company = ${company}
      and not (source = 'LedgerJournalHeaders' and exists (select 1 from d365.journals p where p.company = j.company and p.source <> j.source and p.journal = j.journal and p.module <> 'Inventory'))
    group by 1,2,3 order by case module when 'General ledger' then 1 when 'Accounts receivable' then 2 when 'Accounts payable' then 3 else 4 end, kind`;
}

/** The documents behind one document type, newest first, with how long open ones have been waiting. */
export async function documentRows(company: string, key: string, asOf: string): Promise<DocRow[]> {
  const workers = new Map((await sql<{ p: string; name: string }[]>`select personnel_number p, name from d365.workers`).map((w) => [w.p, w.name]));
  const who = (p: string) => (p ? workers.get(p) ?? p : "");
  if (key === "so") {
    const rows = await salesOrders(company);
    return rows.map((r) => {
      const posted = r.status === 3 || (r.invoiced && r.status !== 4);
      const stage = r.status === 4 ? "Cancelled" : posted ? (r.status === 1 ? SO_DOC[r.doc_status] ?? "Invoiced" : "Invoiced") : r.status === 2 ? "Delivered" : SO_DOC[r.doc_status] ?? SO_STATUS[r.status];
      return { doc: r.sales_order, date: iso(r.created), party: r.customer, stage, posted, user: who(r.taker), amount: r.inv_amount || null,
        age: posted || r.status === 4 ? null : days(iso(r.created), asOf), extra: r.last_invoice ? `Last invoice ${iso(r.last_invoice)}` : "" };
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (key === "po") {
    const rows = await sql<{ purchase_order: string; vendor: string; status: number; approval: number; accounting_date: string; orderer: string }[]>`
      select * from d365.purch_orders where company = ${company} order by accounting_date desc nulls last, purchase_order desc`;
    return rows.map((r) => ({ doc: r.purchase_order, date: iso(r.accounting_date), party: r.vendor, posted: r.status === 3, user: who(r.orderer), amount: null,
      stage: r.status === 1 ? `Open · ${PO_APPROVAL[r.approval] ?? r.approval}` : PO_STATUS[r.status] ?? String(r.status),
      age: r.status === 1 || r.status === 2 ? days(iso(r.accounting_date), asOf) : null }));
  }
  if (key === "prod") {
    const rows = await sql<{ prod_order: string; item: string; status: number; qty: number; delivery_date: string; warehouse: string }[]>`
      select * from d365.prod_orders where company = ${company} order by prod_order desc`;
    return rows.map((r) => ({ doc: r.prod_order, date: iso(r.delivery_date), party: r.item, stage: PROD_STATUS[r.status] ?? String(r.status), posted: r.status === 7,
      user: "", amount: Number(r.qty), age: r.status !== 7 ? days(iso(r.delivery_date), asOf) : null, extra: r.warehouse ? `Warehouse ${r.warehouse}` : "" }));
  }
  if (key === "to") {
    const rows = await sql<{ transfer_order: string; status: number; from_wh: string; to_wh: string; ship_date: string }[]>`
      select * from d365.transfer_orders where company = ${company} order by transfer_order desc`;
    return rows.map((r) => ({ doc: r.transfer_order, date: iso(r.ship_date), party: `${r.from_wh} → ${r.to_wh}`, stage: TO_STATUS[r.status] ?? String(r.status),
      posted: r.status === 2, user: "", amount: null, age: r.status !== 2 ? days(iso(r.ship_date), asOf) : null }));
  }
  if (key.startsWith("j:")) {
    const rows = await sql<{ journal: string; journal_name: string; description: string; posted: number; posted_at: string | null; posted_by: string; amount: number }[]>`
      select journal, journal_name, description, posted, posted_at, posted_by, amount::float from d365.journals
      where company = ${company} and source = ${key.slice(2)} order by posted, journal desc`;
    return rows.map((r) => ({ doc: r.journal, date: iso(r.posted_at), party: r.journal_name, stage: r.posted ? "Posted" : "Not posted", posted: !!r.posted,
      user: r.posted_by ?? "", amount: Number(r.amount) || null, age: null, extra: r.description }));
  }
  return [];
}

/* ------------------------------------------------------------------ User activity */
export interface UserAct { user: string; name: string; so_created: number; so_invoiced: number; invoices: number; inv_amount: number; po: number; journals: number; days: number; first: string | null; last: string | null }
export interface DayAct { user: string; name: string; day: string; n: number; first: string; last: string; hours: number }

/** Who entered what. Sales orders by order taker, invoices by the order's responsible person, POs by orderer,
    inventory journals by the user who posted them. Timestamps exist for order creation and journal posting only. */
export async function userActivity(company: string, from: string, to: string) {
  const ev = await sql<{ user: string; kind: string; at: string; amount: number }[]>`
    select taker as user, 'so' kind, created_at at, 0::float amount from d365.sales_orders where company = ${company} and coalesce(taker,'') <> '' and created_at::date between ${from} and ${to}
    union all
    select responsible, 'inv', invoice_date::timestamptz, total_amount::float from d365.invoice_headers where company = ${company} and coalesce(responsible,'') <> '' and invoice_date between ${from} and ${to}
    union all
    select orderer, 'po', accounting_date::timestamptz, 0 from d365.purch_orders where company = ${company} and coalesce(orderer,'') <> '' and accounting_date between ${from} and ${to}
    union all
    select posted_by, 'jr', posted_at, 0 from d365.journals where company = ${company} and coalesce(posted_by,'') <> '' and posted_at::date between ${from} and ${to}`;
  const workers = new Map((await sql<{ p: string; name: string }[]>`select personnel_number p, name from d365.workers`).map((w) => [w.p, w.name]));
  const users = new Map<string, UserAct>();
  const daysMap = new Map<string, DayAct>();
  const dset = new Map<string, Set<string>>();
  for (const e of ev) {
    const u = users.get(e.user) ?? { user: e.user, name: workers.get(e.user) ?? e.user, so_created: 0, so_invoiced: 0, invoices: 0, inv_amount: 0, po: 0, journals: 0, days: 0, first: null, last: null };
    if (e.kind === "so") u.so_created++;
    if (e.kind === "inv") { u.invoices++; u.inv_amount += Number(e.amount); }
    if (e.kind === "po") u.po++;
    if (e.kind === "jr") u.journals++;
    const at = new Date(e.at).toISOString();
    const day = at.slice(0, 10);
    if (!u.first || day < u.first) u.first = day;
    if (!u.last || day > u.last) u.last = day;
    (dset.get(e.user) ?? dset.set(e.user, new Set()).get(e.user)!).add(day);
    users.set(e.user, u);
    // Time of day is only real for order creation and journal posting.
    if (e.kind === "so" || e.kind === "jr") {
      const k = `${e.user}|${day}`;
      const d = daysMap.get(k) ?? { user: e.user, name: u.name, day, n: 0, first: at, last: at, hours: 0 };
      d.n++; if (at < d.first) d.first = at; if (at > d.last) d.last = at;
      d.hours = (Date.parse(d.last) - Date.parse(d.first)) / 3600000;
      daysMap.set(k, d);
    }
  }
  for (const [k, s] of dset) users.get(k)!.days = s.size;
  return { users: [...users.values()].sort((a, b) => b.so_created + b.invoices + b.po + b.journals - (a.so_created + a.invoices + a.po + a.journals)),
    days: [...daysMap.values()].sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name)) };
}

/* ------------------------------------------------------------------ Expected vs entered */
export const EXPECTED_TYPES: { key: string; label: string }[] = [
  { key: "so", label: "Sales orders created" },
  { key: "inv", label: "Sales invoices posted" },
  { key: "pay", label: "Customer payments posted" },
  { key: "po", label: "Purchase orders" },
  { key: "jr_inv", label: "Inventory journals posted" },
];

/** Count of documents actually entered in D365 per day and type, in the date range. */
export async function enteredCounts(company: string, from: string, to: string) {
  const rows = await sql<{ day: string; t: string; n: number }[]>`
    select created_at::date::text as day, 'so' as t, count(*)::int as n from d365.sales_orders where company = ${company} and created_at::date between ${from} and ${to} group by 1
    union all select invoice_date::text, 'inv', count(*)::int from d365.invoice_headers where company = ${company} and invoice_date between ${from} and ${to} group by 1
    union all select trans_date::text, 'pay', count(*)::int from d365.cust_trans where company = ${company} and trans_type = 15 and trans_date between ${from} and ${to} group by 1
    union all select accounting_date::text, 'po', count(*)::int from d365.purch_orders where company = ${company} and accounting_date between ${from} and ${to} group by 1
    union all select posted_at::date::text, 'jr_inv', count(*)::int from d365.journals where company = ${company} and module = 'Inventory' and posted = 1 and posted_at::date between ${from} and ${to} group by 1`;
  return new Map(rows.map((r) => [`${r.day}|${r.t}`, r.n]));
}
export async function expectedEntries(company: string, from: string, to: string) {
  return sql<{ id: number; day: string; doc_type: string; expected: number; note: string | null; entered_by: string | null }[]>`
    select id, day::text as day, doc_type, expected, note, entered_by from portal.expected_entries where company = ${company} and day between ${from} and ${to} order by day desc, doc_type`;
}

/* ------------------------------------------------------------------ Invoice payment status */
export interface PayRow {
  voucher: string; invoice: string; account: string; name: string; type: number; trans_date: string; due_date: string; amount: number; paid: number;
  remaining: number; closed: string | null; last_settle: string | null; status: "Paid" | "Partially paid" | "Unpaid";
  days_to_pay: number | null; days_overdue: number | null; late_days: number | null; age: number;
}

/** Every customer invoice (sales, free-text, project) with what has been paid, what is left and the days. Accounting currency. */
export async function invoicePayments(s: Scope, asOf: string): Promise<PayRow[]> {
  const rows = await sql<{ voucher: string; invoice: string; account: string; name: string; trans_type: number; trans_date: string; due_date: string; amount: number; settled: number; closed: string | null; last_settle: string | null }[]>`
    select t.voucher, coalesce(nullif(t.invoice,''), t.voucher) invoice, t.account, coalesce(c.name, t.account) name, t.trans_type,
           t.trans_date::text, coalesce(t.due_date, t.trans_date)::text due_date, t.amount_mst::float amount, t.settle_mst::float settled,
           t.closed::text closed, t.last_settle_date::text last_settle
    from d365.cust_trans t left join d365.customers c on c.company = t.company and c.account = t.account
    where t.company = ${s.company} and t.trans_type in (2, 6, 8) and t.amount_mst > 0
      and t.trans_date between ${s.from} and ${s.to} ${customerFilter(s, "t.account")}
    order by t.trans_date desc, t.voucher desc`;
  const d = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  return rows.map((r) => {
    // Settlements after the as-of date do not count yet.
    const settledByAsOf = r.last_settle && r.last_settle > asOf ? 0 : r.settled;
    const paid = Math.min(r.amount, Math.max(0, settledByAsOf));
    const remaining = Math.max(0, r.amount - paid);
    const status = remaining < 0.005 ? "Paid" : paid > 0.005 ? "Partially paid" : "Unpaid";
    return {
      voucher: r.voucher, invoice: r.invoice, account: r.account, name: r.name, type: r.trans_type, trans_date: r.trans_date, due_date: r.due_date,
      amount: r.amount, paid, remaining, closed: r.closed, last_settle: r.last_settle, status,
      days_to_pay: status === "Paid" && r.last_settle ? d(r.last_settle, r.trans_date) : null,
      late_days: status === "Paid" && r.last_settle ? d(r.last_settle, r.due_date) : null,
      days_overdue: status !== "Paid" ? d(asOf, r.due_date) : null,
      age: d(asOf, r.trans_date),
    };
  });
}
