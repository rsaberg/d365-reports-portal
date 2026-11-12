import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "../db";
import { generateDemo, seedReport, DEMO_AS_OF } from "./demo";
import { CATALOG, REPORTS } from "./catalog";

/**
 * Sales Intelligence storage: creates the `si` schema on first use, registers the KPI and report catalogs, and keeps
 * the DEMO company `dat` (full deterministic dataset) and `dat2` (empty company for isolation tests) loaded.
 * Real companies are filled by projecting the already-synced D365 tables (`d365.*`) into the semantic model; this
 * module never writes to D365.
 */
let ready: Promise<void> | null = null;
export const DEMO_COMPANY = "dat";
export const EMPTY_COMPANY = "dat2";

export function ensureSi() {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  return ready;
}

async function init() {
  await sql.unsafe(readFileSync(join(process.cwd(), "db/si.sql"), "utf8"));
  const [m] = await sql<{ n: number; v: string | null }[]>`select count(*)::int n, max(version) v from si.metric`;
  if (m.n !== CATALOG.length || m.v !== CATALOG_VERSION) await registerCatalog();
  const [d] = await sql<{ n: number }[]>`select count(*)::int n from si.company where company = ${DEMO_COMPANY}`;
  if (!d.n) await loadDemo();
}
export const CATALOG_VERSION = "sales-kpi-v1.0";

export async function registerCatalog() {
  await sql.begin(async (tx) => {
    await tx`delete from si.metric`;
    for (const part of chunk(CATALOG.map((k) => ({ metric_id: k.id, domain: k.domain, label_en: k.name, label_ar: k.ar ?? null, definition: k.definition,
      unit: k.unit, aggregation: k.aggregation, event_layer: k.layer, date_role: k.dateRole, status: k.status, version: CATALOG_VERSION, owner: "Finance" })), 500))
      await tx`insert into si.metric ${tx(part)}`;
    await tx`delete from si.report_def`;
    for (const part of chunk(REPORTS.map((r) => ({ report_id: r.id, domain: r.domainName, name: r.name, question: r.question, grain: r.grain, route: r.route ?? null, status: r.status })), 500))
      await tx`insert into si.report_def ${tx(part)}`;
  });
}

function chunk<T>(a: T[], n: number) { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
async function bulk(tx: any, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const per = Math.max(1, Math.floor(60000 / Object.keys(rows[0]).length));
  for (const part of chunk(rows, per)) await tx`insert into ${tx(table)} ${tx(part)}`;
}
const FACTS = ["invoice_line", "slip_line", "order_line", "ar_trans", "settlement", "target", "customer", "product", "salesperson", "territory", "channel", "warehouse", "holiday", "sync_health"];
async function clearCompany(tx: any, company: string) {
  for (const t of FACTS) await tx`delete from ${tx(`si.${t}`)} where company = ${company}`;
}

/** (Re)load the deterministic DEMO dataset into `dat` and the empty `dat2`. Every row is clearly a DEMO row. */
export async function loadDemo() {
  const d = generateDemo();
  const c = DEMO_COMPANY;
  const batch = `DEMO-${DEMO_AS_OF}`;
  const fx = new Map(d.fx.map((x) => [x.date, x.rate]));
  await sql.begin(async (tx) => {
    for (const co of [c, EMPTY_COMPANY]) { await clearCompany(tx, co); await tx`delete from si.company where company = ${co}`; }
    await tx`insert into si.company ${tx([
      { company: c, tenant: "DEMO", name: "DEMO · GrowPath Distribution (dat)", currency: "EGP", fiscal_start_month: 1, week_start: 6, weekend: [5], timezone: "Africa/Cairo", mode: "DEMO", data_as_of: DEMO_AS_OF },
      { company: EMPTY_COMPANY, tenant: "DEMO", name: "DEMO · Empty company (dat2)", currency: "SAR", fiscal_start_month: 7, week_start: 0, weekend: [5, 6], timezone: "Asia/Riyadh", mode: "DEMO", data_as_of: DEMO_AS_OF },
    ])}`;
    const C = (rows: Record<string, unknown>[]) => rows.map((r) => ({ company: c, ...r }));
    await bulk(tx, "si.territory", C(d.territories));
    await bulk(tx, "si.channel", C(d.channels));
    await bulk(tx, "si.warehouse", C(d.warehouses));
    await bulk(tx, "si.salesperson", C(d.salespeople));
    await bulk(tx, "si.customer", C(d.customers));
    await bulk(tx, "si.product", C(d.products));
    await tx`delete from si.fx_rate where from_cur = 'USD' and to_cur = 'EGP'`;
    await bulk(tx, "si.fx_rate", d.fx.map((x) => ({ from_cur: x.from, to_cur: x.to, date: x.date, rate: x.rate })));
    await bulk(tx, "si.order_line", C(d.orderLines.map((o) => {
      const rate = o.currency === "USD" ? fx.get(o.created) ?? 1 : 1;
      return { ...o, net_mst: Math.round(o.net_amount * rate * 100) / 100, source_key: `DEMO:${o.order_id}/${o.line_no}` };
    })));
    await bulk(tx, "si.slip_line", C(d.slipLines.map(({ value, ...s }) => ({ ...s, value_mst: value, source_key: `DEMO:${s.slip_id}/${s.order_id}/${s.line_no}` }))));
    await bulk(tx, "si.invoice_line", C(d.invoiceLines.map((l) => ({
      ...l, gross_mst: Math.round(l.gross * l.fx_rate * 100) / 100, discount_mst: Math.round(l.discount * l.fx_rate * 100) / 100,
      cogs_restated_mst: Math.round(l.cogs_restated * l.fx_rate * 100) / 100, source_key: `DEMO:${l.invoice_line_key}`, sync_batch: batch,
    }))));
    await bulk(tx, "si.ar_trans", C(d.arTrans));
    await bulk(tx, "si.settlement", C(d.settlements));
    await bulk(tx, "si.target", C(d.targets));
    const r = seedReport(d);
    const now = new Date();
    await bulk(tx, "si.sync_health", [
      ["invoice_line", r.counts.invoiceLines + r.counts.creditLines], ["order_line", r.counts.orderLines], ["slip_line", r.counts.slipLines], ["ar_trans", r.counts.arTrans], ["settlement", r.counts.settlements],
    ].map(([entity, rows]) => ({ company: c, entity, last_success: now, watermark: DEMO_AS_OF, rows, latency_min: 0, status: "DEMO", message: "Deterministic demo dataset (seed 3652026). Not D365 data." })));
    await tx`insert into si.audit ${tx({ action: "demo.load", target: c, detail: { netSalesMst: r.netSalesMst, counts: r.counts } as never })}`;
  });
}

/**
 * CONNECTED_D365: project the already-synced D365 tables for one real company into the semantic model.
 * Only fields that exist in the synced entities are filled; everything else stays NULL and is flagged on the
 * Connection Health page (e.g. COGS, packing slips and settlement history are not in the standard entities synced today).
 */
export async function projectFromD365(company: string, userId: number | null) {
  const [co] = await sql<{ company: string; name: string | null; currency: string | null }[]>`select company, name, currency from d365.companies where company = ${company}`;
  if (!co) throw new Error(`Company ${company} is not synced from D365.`);
  if (company === DEMO_COMPANY || company === EMPTY_COMPANY) throw new Error("Demo companies cannot be overwritten.");
  const mst = co.currency ?? "";
  const counts: Record<string, number> = {};
  await sql.begin(async (tx) => {
    await clearCompany(tx, company);
    await tx`insert into si.company (company, tenant, name, currency, mode, data_as_of)
             values (${company}, 'D365', ${co.name ?? company.toUpperCase()}, ${mst}, 'CONNECTED_D365',
                     (select max(invoice_date) from d365.invoice_lines where company = ${company}))
             on conflict (company) do update set name = excluded.name, currency = excluded.currency, mode = 'CONNECTED_D365', data_as_of = excluded.data_as_of`;
    await tx`insert into si.territory (company, code, name, region)
             select distinct ${company}, sales_district, sales_district, null from d365.customers where company = ${company} and coalesce(sales_district,'') <> ''`;
    await tx`insert into si.channel (company, code, name)
             select distinct ${company}, segment, segment from d365.customers where company = ${company} and coalesce(segment,'') <> ''`;
    await tx`insert into si.salesperson (company, code, name)
             select distinct on (h.responsible) ${company}, h.responsible, coalesce(w.name, h.responsible) from d365.invoice_headers h
             left join d365.workers w on w.personnel_number = h.responsible where h.company = ${company} and coalesce(h.responsible,'') <> ''`;
    await tx`insert into si.customer (company, account, name, invoice_account, cust_group, segment, territory, channel, city, credit_limit, currency)
             select ${company}, account, name, account, cust_group, segment, nullif(sales_district,''), nullif(segment,''), city, credit_limit, currency
             from d365.customers where company = ${company}`;
    await tx`insert into si.product (company, item, name, category, item_group, uom)
             select ${company}, l.item, max(coalesce(p.name, l.item_name)), max(nullif(l.category,'')), max(p.item_group), max(coalesce(p.unit, l.unit))
             from d365.invoice_lines l left join d365.products p on p.company = l.company and p.item = l.item
             where l.company = ${company} and l.item is not null group by l.item`;
    // Invoice + credit lines. Net Sales numerator = LineAmount (ex-VAT, after line discount). Accounting-currency amount only
    // when the document is in the accounting currency; foreign-currency lines keep net_mst NULL until an FX source is mapped.
    const inv = await tx`
      insert into si.invoice_line (company, invoice_line_key, invoice_id, invoice_date, order_id, customer, invoice_account, item, uom, qty, price,
        gross, discount, net, tax, currency, fx_rate, net_mst, gross_mst, discount_mst, salesperson, territory, channel, warehouse,
        doc_type, credit_class, source_key, sync_batch)
      select ${company}, l.invoice || '-' || coalesce(l.line_seq, l.id), l.invoice, l.invoice_date, nullif(h.sales_order,''), h.customer, h.customer, l.item, l.unit,
        l.qty, l.price, l.line_amount + l.discount, l.discount, l.line_amount, l.tax, l.currency,
        case when l.currency = ${mst} then 1 end,
        case when l.currency = ${mst} then l.line_amount end, case when l.currency = ${mst} then l.line_amount + l.discount end, case when l.currency = ${mst} then l.discount end,
        nullif(h.responsible,''), nullif(c.sales_district,''), nullif(c.segment,''), nullif(l.warehouse,''),
        case when l.line_amount < 0 then 'credit' else 'invoice' end,
        case when l.line_amount < 0 and l.qty < 0 then 'physical_return' when l.line_amount < 0 then 'commercial_credit' end,
        'D365:SalesInvoiceV4Lines:' || l.id, 'D365-SYNC'
      from d365.invoice_lines l
      left join lateral (select * from d365.invoice_headers h where h.company = l.company and h.invoice = l.invoice limit 1) h on true
      left join d365.customers c on c.company = l.company and c.account = h.customer
      where l.company = ${company}
      on conflict do nothing`;
    counts.invoice_line = inv.count;
    const ol = await tx`
      insert into si.order_line (company, order_id, line_no, customer, invoice_account, created, requested_ship, confirmed_ship, item, qty, price,
        discount_pct, net_amount, currency, net_mst, salesperson, channel, warehouse, status, source_key)
      select ${company}, l.sales_order, coalesce(l.line_seq, l.id::int), h.customer, h.invoice_account, coalesce(h.created, l.requested_ship), l.requested_ship, l.confirmed_ship,
        l.item, l.qty, l.price, l.discount_pct, l.line_amount, l.currency, case when l.currency = ${mst} then l.line_amount end,
        nullif(h.responsible,''), nullif(c.segment,''), nullif(l.warehouse,''), l.status::text, 'D365:SalesOrderLinesV3:' || l.id
      from d365.order_lines l join d365.order_headers h on h.company = l.company and h.sales_order = l.sales_order
      left join d365.customers c on c.company = h.company and c.account = h.customer
      where l.company = ${company} and coalesce(h.created, l.requested_ship) is not null
      on conflict do nothing`;
    counts.order_line = ol.count;
    // Customer transactions. D365 CustTransactions gives the current settled amount only (no settlement history),
    // so as-of AR for past dates is approximate in CONNECTED mode — flagged on Connection Health.
    const ar = await tx`
      insert into si.ar_trans (company, trans_id, customer, doc_type, doc_id, trans_date, due_date, amount)
      select ${company}, rec_id::text, account, case when amount_mst < 0 then 'payment' else 'invoice' end, coalesce(nullif(invoice,''), voucher), trans_date, coalesce(due_date, trans_date), amount_mst
      from d365.cust_trans where company = ${company} and trans_date is not null`;
    counts.ar_trans = ar.count;
    const st = await tx`
      insert into si.settlement (company, settle_id, debit_trans, credit_trans, settle_date, amount)
      select ${company}, 'S-' || rec_id, rec_id::text, null, coalesce(last_settle_date, closed, trans_date), abs(settle_mst)
      from d365.cust_trans where company = ${company} and trans_date is not null and settle_mst <> 0 and amount_mst > 0`;
    counts.settlement = st.count;
    await tx`insert into si.target (company, version, status, salesperson, month, amount)
             select ${company}, 1, 'approved', personnel_number, month, amount from portal.targets where company = ${company}`;
    const [last] = await tx<{ finished_at: Date | null }[]>`select max(finished_at) finished_at from d365.sync_runs where company = ${company} and status = 'ok'`;
    const health = [
      { entity: "invoice_line", rows: counts.invoice_line, status: counts.invoice_line ? "OK" : "EMPTY", message: "SalesInvoiceHeadersV4 + SalesInvoiceV4Lines. COGS not in the entity: margin KPIs are BLOCKED BY SOURCE until a cost entity is synced." },
      { entity: "order_line", rows: counts.order_line, status: counts.order_line ? "OK" : "EMPTY", message: "SalesOrderHeadersV4 + SalesOrderLinesV3. Confirmation/cancellation dates not in the entity." },
      { entity: "slip_line", rows: 0, status: "MISSING", message: "Packing slip lines are not synced (CustPackingSlipTrans entity needed): Delivered, OTIF and Delivered-not-invoiced are BLOCKED BY SOURCE." },
      { entity: "ar_trans", rows: counts.ar_trans, status: counts.ar_trans ? "OK" : "EMPTY", message: "CustTransactions. Current settlement only: AR as of past dates is approximate." },
      { entity: "settlement", rows: counts.settlement, status: "PARTIAL", message: "Derived from CustTransactions.SettleAmountMST / last settle date (no CustSettlement history)." },
    ];
    await bulk(tx, "si.sync_health", health.map((h) => ({ company, last_success: last?.finished_at ?? null, watermark: null, latency_min: last?.finished_at ? Math.round((Date.now() - last.finished_at.getTime()) / 60000) : null, ...h })));
    await tx`insert into si.audit ${tx({ user_id: userId, action: "d365.project", target: company, detail: counts as never })}`;
  });
  return counts;
}
