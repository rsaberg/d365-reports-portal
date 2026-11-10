import "server-only";
import { sql } from "../db";
import type { Ctx, ModuleDef, Spec } from "./modules";

/* EE Cable Accessories — initial requirements (72 requests from the client's list).
   "tracker" maps every request to the portal report that answers it, or says what is still needed.
   Reports that were missing elsewhere (vendor master, PO log, open POs, min/max & lead time, HR lists) are built here
   from standard D365 entities: VendorsV2, PurchaseOrderLinesV2 (+ PurchaseOrderHeadersV2), ItemCoverageSettings, EmployeesV2. */

type Status = "Portal" | "Portal (new)" | "Needs D365 entity" | "Document";
const R = (section: string, request: string, dept: string, status: Status, link?: string, how?: string) => ({ section, request, dept, status, link, how });

const ITEMS = [
  R("General", "Financial statements for 31/12/2025", "Finance", "Portal", "/finance/income", "Income statement, balance sheet, cash flow (GL)"),
  R("General", "Trial balance as of 31/12/2025 & 31/10/2026 (opening, debit, credit, closing)", "Finance", "Portal", "/finance/trial", "Trial balance"),
  R("General", "All latest insurance policies", "Finance", "Document"),
  R("General", "Latest legal position", "Finance", "Document"),
  R("General", "Latest tax position", "Finance", "Document"),
  R("General", "Approved OPEX & CAPEX actual vs budget 2025 & 2026", "Finance", "Portal", "/finance/budget", "Budget vs actual (budget register entries)"),
  R("General", "Latest commercial register", "Finance", "Document"),
  R("General", "All available policies and procedures", "Finance", "Document"),
  R("General", "Latest approved authority matrix", "Finance / QA", "Document"),
  R("Procurement & AP", "Supplier PR and PO log 01/01/2025 – 31/10/2026", "Procurement", "Portal (new)", "/m/ee?r=polog", "PO lines log; PR lines need PurchaseRequisition entity access"),
  R("Procurement & AP", "All procurement policies and procedures", "Procurement", "Document"),
  R("Procurement & AP", "Approved procurement plan 2026", "Procurement", "Document"),
  R("Procurement & AP", "Latest vendors master file", "Procurement", "Portal (new)", "/m/ee?r=vendors", "VendorsV2"),
  R("Procurement & AP", "Approved sole supplier list", "Procurement", "Document"),
  R("Procurement & AP", "Open approved PRs without PO and open approved POs not delivered", "Procurement", "Portal (new)", "/m/ee?r=openpo", "Open PO lines; open PRs need PurchaseRequisition entity access"),
  R("Procurement & AP", "AP confirmations (latest)", "Finance", "Document"),
  R("Procurement & AP", "AP, advances to suppliers & retention aging as of 30/11/2025", "Finance", "Portal", "/m/payables?r=aging", "Vendor aging (vendor transactions entity)"),
  R("Procurement & AP", "AP open invoices as of 30/11/2025", "Finance", "Portal", "/m/payables?r=due", "Payments due"),
  R("Procurement & AP", "Analysis of advances to suppliers as of 30/11/2025", "Finance", "Needs D365 entity", undefined, "Vendor prepayments (VendTrans with prepayment flag)"),
  R("Procurement & AP", "Suppliers evaluation and black-listed vendors", "Finance", "Portal (new)", "/m/ee?r=vendors", "On-hold status in the vendor master; evaluation is a document"),
  R("Procurement & AP", "Notes payable analysis as of 30/11/2025", "Finance", "Needs D365 entity", undefined, "Promissory notes (vendor)"),
  R("Procurement & AP", "Open LGs from suppliers", "Finance", "Needs D365 entity", undefined, "Bank letters of guarantee"),
  R("Inventory", "All inventory policies and procedures", "Finance / QA", "Document"),
  R("Inventory", "Inventory aging as of 31/10/2026", "Finance", "Portal (new)", "/m/inventory?r=aging", "InventTransV5, D365 aging method"),
  R("Inventory", "WIP aging as of 31/10/2026", "Finance", "Needs D365 entity", undefined, "WIP balance per production order (ProdTable + cost)"),
  R("Inventory", "Inventory by lot number and expiry date (qty and value)", "Finance", "Portal", "/m/inventory?r=batch", "Batch & expiry (needs batch dimension in the sync)"),
  R("Inventory", "Goods under inspection as of 31/10/2026", "Finance", "Needs D365 entity", undefined, "Quality orders / inventory status"),
  R("Inventory", "Inventory movement 01/01/2026 – 31/10/2026 (opening, receipts, issues, closing — qty & value)", "Finance", "Portal (new)", "/m/inventory?r=stockmove", "InventTransV5"),
  R("Inventory", "On-hand reserved and free stock — finished goods", "Finance / FG Warehouse", "Portal", "/m/inventory?r=onhand", "On-hand by site (physical / reserved / available)"),
  R("Inventory", "On-hand reserved and free stock — raw materials", "Planning / Finance", "Portal", "/m/inventory?r=onhand", "On-hand by site; filter by item group"),
  R("Inventory", "Latest safety stock analysis by item", "Planning", "Portal (new)", "/m/ee?r=coverage", "ItemCoverageSettings (min = safety stock)"),
  R("Inventory", "Open job orders: standard vs actual quantity", "Planning / Production", "Portal", "/m/production?r=output", "Output vs plan"),
  R("Inventory", "Items lead time report", "Planning / Procurement", "Portal (new)", "/m/ee?r=coverage", "ItemCoverageSettings lead times"),
  R("Inventory", "Minimum / maximum balances for inventory items", "Planning", "Portal (new)", "/m/ee?r=coverage", "ItemCoverageSettings"),
  R("Inventory", "Goods in transit analysis", "Procurement", "Portal", "/m/warehouse?r=transit", "Transfers in transit"),
  R("Inventory", "Physical count and matching with book balances", "Finance", "Portal", "/ops/documents", "Counting journals; count sheets are documents"),
  R("Inventory", "Scrap inventory analysis as of 31/10/2026", "Finance", "Needs D365 entity", undefined, "Scrap warehouse / inventory status setup"),
  R("Inventory", "Inventory provision analysis as of 31/10/2026", "Finance", "Portal (new)", "/m/inventory?r=aging", "Aging buckets > 180 days as provision base"),
  R("Fixed Assets", "Fixed assets register as of 31/10/2026", "Finance", "Portal", "/m/assets?r=register"),
  R("Fixed Assets", "Fixed assets additions and disposals 2026", "Finance", "Portal", "/m/assets?r=movements"),
  R("Fixed Assets", "Construction in process as of 31/10/2026", "Finance", "Portal", "/finance/trial", "CIP accounts in the trial balance"),
  R("Fixed Assets", "Monthly machine utilization (standard vs actual capacity)", "Planning / Production", "Needs D365 entity", undefined, "Route card / resource capacity"),
  R("Fixed Assets", "Approved CAPEX actual vs budget 2025 & 2026", "Finance", "Portal", "/finance/budget"),
  R("Fixed Assets", "Fixed assets physical count and matching", "Finance", "Document"),
  R("Sales & AR", "Guarantees from customers (cheques, insurance…)", "Finance", "Needs D365 entity", undefined, "Customer bank guarantees / notes"),
  R("Sales & AR", "Sales analysis by invoice 01/01/2025 – 31/10/2026", "Finance", "Portal", "/sales/invoices", "Invoice register"),
  R("Sales & AR", "Standard vs actual GP for all sales orders", "Finance", "Portal", "/m/margin", "Sales margin (actual cost from inventory movement once loaded)"),
  R("Sales & AR", "Planned vs actual delivery dates 2026", "Finance", "Portal", "/sales/delivery", "Delivery schedule"),
  R("Sales & AR", "Open sales order analysis", "Finance", "Portal", "/sales/open-orders"),
  R("Sales & AR", "Sales order analysis 01/01/2025 – 31/10/2026", "Finance", "Portal", "/sales/performance"),
  R("Sales & AR", "Scrap sales analysis", "Finance", "Portal", "/sales/invoices", "Invoice register filtered by scrap item group"),
  R("Sales & AR", "Customers credit limit report", "Finance / ERP", "Portal", "/m/receivables?r=credit", "Credit limit use"),
  R("Sales & AR", "AR, advances from customers & retention aging as of 31/10/2026", "Finance", "Portal", "/sales/aging", "Customer aging (CustTransactions)"),
  R("Sales & AR", "AR write-offs 2025 & 2026", "Finance", "Portal", "/sales/statement", "Statement (write-off transactions)"),
  R("Sales & AR", "AR open invoices as of 31/10/2026", "Finance", "Portal", "/sales/payments", "Invoice payment status"),
  R("Sales & AR", "AR retention analysis", "Finance", "Needs D365 entity", undefined, "Retention terms on project/customer invoices"),
  R("Sales & AR", "Allowance for doubtful accounts and calculation", "Finance", "Portal", "/sales/aging", "Aging buckets as calculation base"),
  R("Sales & AR", "Notes receivable analysis", "Finance", "Needs D365 entity", undefined, "Customer promissory notes / bills of exchange"),
  R("Sales & AR", "AR confirmations", "Finance", "Portal", "/sales/statement", "Customer statements"),
  R("Sales & AR", "Analysis of advances from customers", "Finance", "Portal", "/sales/aging", "Credit balances / prepayments in customer aging"),
  R("HR", "Terminations / resignations 2025 & 2026", "HR", "Portal (new)", "/m/ee?r=hr", "EmployeesV2"),
  R("HR", "New hires 2025 & 2026", "HR", "Portal (new)", "/m/ee?r=hr", "EmployeesV2"),
  R("HR", "Latest employee master file", "HR", "Portal (new)", "/m/ee?r=hr", "EmployeesV2"),
  R("Costing", "WIP analysis per job order as of 31/10/2026", "Costing", "Portal", "/m/cost?r=production", "Production order costing"),
  R("Costing", "Raw material in WIP per job order", "Costing", "Portal", "/m/production?r=material", "Material consumption vs BOM"),
  R("Costing", "Closed work orders: standard vs actual variances 2026", "Costing", "Portal", "/m/cost?r=production"),
  R("Costing", "Material over-consumption 2026", "Costing", "Portal", "/m/production?r=material"),
  R("Costing", "Raw material returned from WIP to RM warehouse 2026", "Costing", "Needs D365 entity", undefined, "Production journal returns (ProdJournalBOM)"),
  R("Costing", "Standard vs actual machine hours per machine 2026", "Costing", "Needs D365 entity", undefined, "Route card journal (ProdJournalRoute)"),
  R("ERP", "ERP users (active / inactive) with last login", "ERP / Finance", "Portal", "/m/security?r=users", "Users & roles; last login needs SysUserLog entity"),
  R("ERP", "Approval hierarchy flows (PR & PO)", "ERP / Finance", "Document", undefined, "Workflow configuration export"),
  R("ERP", "User authorities and responsibilities", "ERP / Finance", "Portal", "/m/security?r=roles", "Roles & members, segregation of duties"),
];

const N = (x: number) => Math.round(x).toLocaleString("en-US");
const S = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0); };
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const qs = (c: Ctx) => `company=${encodeURIComponent(c.company)}&from=${c.from}&to=${c.to}`;
const group = (rows: any[], key: string, val?: string) => [...rows.reduce((m, r) => m.set(r[key] || "–", (m.get(r[key] || "–") ?? 0) + (val ? Number(r[val]) || 0 : 1)), new Map<string, number>())]
  .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12);
const empty = (what: string): Spec => ({ kpis: [{ label: what, value: "Not loaded", tone: "warn" }], note: `Run Administration › Data sync for this company to load ${what}.` });

const tracker = { key: "tracker", label: "Requirements tracker", run: async (c: Ctx): Promise<Spec> => {
  const rows = ITEMS.map((i, n) => ({ no: n + 1, ...i, open: i.link ? `${i.link}${i.link.includes("?") ? "&" : "?"}${qs(c)}` : "" , open_label: i.link ? "Open" : "" }));
  const cnt = (s: Status) => rows.filter((r) => r.status === s).length;
  return {
    kpis: [{ label: "Requests", value: N(rows.length) }, { label: "In the portal", value: N(cnt("Portal") + cnt("Portal (new)")), tone: "good", note: `${cnt("Portal (new)")} built for this list` },
      { label: "Need a D365 entity", value: N(cnt("Needs D365 entity")), tone: "warn" }, { label: "Documents (outside ERP)", value: N(cnt("Document")) }],
    charts: [{ title: "Requests by section", kind: "rank", data: group(rows, "section") }, { title: "Requests by status", kind: "rank", data: group(rows, "status") }],
    tables: [{ title: "EE Cable Accessories — initial requirements", sub: "click Open to go to the report with the current company and period", rows,
      cols: [{ key: "no", label: "#", type: "int" }, { key: "section", label: "Section" }, { key: "request", label: "Request", wrap: true }, { key: "dept", label: "Department" },
        { key: "status", label: "Status" }, { key: "how", label: "Source / note", wrap: true }, { key: "open_label", label: "Report", href: "@open" }] }],
    note: "Status: Portal = an existing report answers it; Portal (new) = built for this list; Needs D365 entity = the data is not exposed by a standard entity (custom entity or access needed); Document = a file outside the ERP.",
  };
} };

const vendors = { key: "vendors", label: "Vendor master file", run: async (c: Ctx): Promise<Spec> => {
  const rows = await sql<any[]>`select vendor, name, search_name, vendor_group, currency, payment_terms, country, city, phone, email, on_hold, credit_limit::float, party_type, tax_reg, bank_account
    from d365.vendors_m where company = ${c.company} order by vendor`;
  if (!rows.length) return empty("vendors (VendorsV2)");
  const hold = rows.filter((r) => r.on_hold && !/^(No|0)$/i.test(r.on_hold));
  return {
    kpis: [{ label: "Vendors", value: N(rows.length) }, { label: "On hold / blocked", value: N(hold.length), tone: hold.length ? "bad" : "good" },
      { label: "Vendor groups", value: N(new Set(rows.map((r) => r.vendor_group)).size) }, { label: "Currencies", value: [...new Set(rows.map((r) => r.currency))].slice(0, 4).join(", ") }],
    charts: [{ title: "Vendors by group", kind: "rank", data: group(rows, "vendor_group") }, { title: "Vendors by country", kind: "rank", data: group(rows, "country") }],
    tables: [{ title: "Vendors master file", sub: "from D365 VendorsV2", rows,
      cols: [{ key: "vendor", label: "Vendor" }, { key: "name", label: "Name" }, { key: "vendor_group", label: "Group" }, { key: "currency", label: "Currency" }, { key: "payment_terms", label: "Payment terms" },
        { key: "country", label: "Country" }, { key: "city", label: "City" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "tax_reg", label: "Tax reg." },
        { key: "bank_account", label: "Bank account" }, { key: "on_hold", label: "On hold" }, { key: "credit_limit", label: "Credit limit", type: "money" }] }],
  };
} };

const poLines = (c: Ctx, open: boolean) => sql<any[]>`
  select l.purchase_order, l.line::float, h.accounting_date::text order_date, h.vendor, coalesce(v.name, h.vendor) vendor_name, l.item, coalesce(p.name, l.description) item_name, l.category,
    l.qty::float, l.unit, l.price::float, l.amount::float, l.status, l.requisition, l.requested::text, l.confirmed::text, l.warehouse,
    greatest(0, ${c.asOf}::date - coalesce(l.confirmed, l.requested))::int days_late
  from d365.purch_lines l left join d365.purch_orders h on h.company = l.company and h.purchase_order = l.purchase_order
    left join d365.vendors_m v on v.company = l.company and v.vendor = h.vendor left join d365.products p on p.company = l.company and p.item = l.item
  where l.company = ${c.company} and ${open ? sql`l.status in ('Backorder','Open order','None')` : sql`coalesce(h.accounting_date, l.requested) between ${c.from} and ${c.to}`}
  order by coalesce(h.accounting_date, l.requested) desc nulls last, l.purchase_order, l.line limit 20000`;
const poCols = (late: boolean) => [{ key: "purchase_order", label: "PO" }, { key: "line", label: "Line", type: "num" as const }, { key: "order_date", label: "Order date", type: "date" as const },
  { key: "vendor_name", label: "Vendor" }, { key: "item", label: "Item" }, { key: "item_name", label: "Description" }, { key: "qty", label: "Qty", type: "num" as const }, { key: "unit", label: "Unit" },
  { key: "price", label: "Price", type: "money" as const }, { key: "amount", label: "Amount", type: "money" as const }, { key: "status", label: "Status" }, { key: "requisition", label: "PR" },
  { key: "requested", label: "Requested", type: "date" as const }, { key: "confirmed", label: "Confirmed", type: "date" as const }, { key: "warehouse", label: "Warehouse" },
  ...(late ? [{ key: "days_late", label: "Days late", type: "int" as const, tone: "badIfPositive" as const }] : [])];

const polog = { key: "polog", label: "PR / PO log", run: async (c: Ctx): Promise<Spec> => {
  const rows = await poLines(c, false);
  if (!rows.length) return empty("purchase order lines (PurchaseOrderLinesV2)");
  const pos = new Set(rows.map((r) => r.purchase_order)).size;
  return {
    kpis: [{ label: "Purchase orders", value: N(pos) }, { label: "Lines", value: N(rows.length) }, { label: "Amount", value: S(sum(rows, "amount")), note: "line amounts, order currency" },
      { label: "Lines from a PR", value: N(rows.filter((r) => r.requisition).length) }, { label: "Vendors", value: N(new Set(rows.map((r) => r.vendor)).size) }],
    charts: [{ title: "Amount by vendor (top 12)", kind: "rank", money: true, data: group(rows, "vendor_name", "amount") }, { title: "Lines by status", kind: "rank", data: group(rows, "status") }],
    tables: [{ title: "Purchase order lines", sub: `${c.from} – ${c.to} · by order (accounting) date`, rows, cols: poCols(false) }],
    note: "Purchase requisitions (PR lines without a PO) are not readable through the standard entity in this environment — grant the integration user access to PurchaseRequisitionHeaders/Lines, or add a custom entity.",
  };
} };

const openpo = { key: "openpo", label: "Open POs not delivered", run: async (c: Ctx): Promise<Spec> => {
  const rows = await poLines(c, true);
  if (!(await sql`select 1 from d365.purch_lines where company = ${c.company} limit 1`).length) return empty("purchase order lines (PurchaseOrderLinesV2)");
  const late = rows.filter((r) => r.days_late > 0);
  return {
    kpis: [{ label: "Open lines", value: N(rows.length) }, { label: "Open POs", value: N(new Set(rows.map((r) => r.purchase_order)).size) }, { label: "Open amount", value: S(sum(rows, "amount")) },
      { label: "Past delivery date", value: N(late.length), tone: late.length ? "bad" : "good" }],
    charts: [{ title: "Open amount by vendor (top 12)", kind: "rank", money: true, data: group(rows, "vendor_name", "amount") },
      { title: "Days past delivery date", kind: "bucket", data: [["Not due", (r: any) => r.days_late <= 0], ["1–30", (r: any) => r.days_late > 0 && r.days_late <= 30], ["31–90", (r: any) => r.days_late > 30 && r.days_late <= 90], ["Over 90", (r: any) => r.days_late > 90]]
        .map(([label, f]: any) => ({ label, value: rows.filter(f).length })) }],
    tables: [{ title: "Open purchase order lines (status Backorder)", sub: `as of ${c.asOf}`, rows, cols: poCols(true) }],
  };
} };

const coverage = { key: "coverage", label: "Min / max, safety stock & lead time", run: async (c: Ctx): Promise<Spec> => {
  const rows = await sql<any[]>`
    with oh as (select item, sum(rq - iq)::float q from d365.invent_mov where company = ${c.company} and day <= ${c.asOf} group by item)
    select k.item, coalesce(p.name, k.item) name, p.item_group, p.unit, k.site, k.warehouse, k.vendor, k.min_qty::float, k.max_qty::float, k.purch_lead, k.prod_lead, k.transfer_lead, k.coverage_days,
      oh.q on_hand
    from d365.item_coverage k left join d365.products p on p.company = k.company and p.item = k.item left join oh on oh.item = k.item
    where k.company = ${c.company} order by k.item`;
  if (!rows.length) return empty("item coverage settings (ItemCoverageSettings)");
  const out = rows.map((r) => ({ ...r, status: r.on_hand == null ? "No stock data" : r.on_hand < r.min_qty ? "Below minimum" : r.max_qty && r.on_hand > r.max_qty ? "Above maximum" : "Within range" }));
  return {
    kpis: [{ label: "Items with coverage", value: N(out.length) }, { label: "Below minimum", value: N(out.filter((r) => r.status === "Below minimum").length), tone: "bad" },
      { label: "Above maximum", value: N(out.filter((r) => r.status === "Above maximum").length), tone: "warn" },
      { label: "Avg purchase lead time", value: `${(sum(out, "purch_lead") / Math.max(1, out.filter((r) => r.purch_lead).length)).toFixed(0)} days` }],
    tables: [{ title: "Item coverage: minimum (safety stock), maximum and lead times", sub: `on hand from inventory transactions as of ${c.asOf}`, rows: out,
      cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "item_group", label: "Group" }, { key: "site", label: "Site" }, { key: "warehouse", label: "Warehouse" },
        { key: "vendor", label: "Vendor" }, { key: "min_qty", label: "Minimum / safety", type: "num" }, { key: "max_qty", label: "Maximum", type: "num" }, { key: "on_hand", label: "On hand", type: "num" },
        { key: "status", label: "Status" }, { key: "purch_lead", label: "Purchase lead (d)", type: "int" }, { key: "prod_lead", label: "Production lead (d)", type: "int" },
        { key: "transfer_lead", label: "Transfer lead (d)", type: "int" }, { key: "coverage_days", label: "Coverage period (d)", type: "int" }] }],
    note: "Items without their own coverage settings use the coverage group defaults in D365 and are not listed.",
  };
} };

const hr = { key: "hr", label: "Employees: master, hires, leavers", run: async (c: Ctx): Promise<Spec> => {
  const rows = await sql<any[]>`select personnel_number, name, legal_entity, title, original_hire::text, start_date::text, end_date::text, termination_date::text, termination_reason
    from d365.workers where legal_entity is null or lower(legal_entity) = ${c.company} order by personnel_number`;
  if (!rows.some((r) => r.start_date)) return empty("employees (EmployeesV2)");
  const hires = rows.filter((r) => r.start_date && r.start_date >= c.from && r.start_date <= c.to);
  const leave = (r: any) => r.termination_date || (r.end_date && r.end_date < "2154-01-01" ? r.end_date : null);
  const leavers = rows.filter((r) => { const d = leave(r); return d && d >= c.from && d <= c.to; }).map((r) => ({ ...r, left_on: leave(r) }));
  const active = rows.filter((r) => { const d = leave(r); return !d || d > c.asOf; });
  const cols = [{ key: "personnel_number", label: "Personnel no." }, { key: "name", label: "Name" }, { key: "legal_entity", label: "Company" }, { key: "title", label: "Title" },
    { key: "original_hire", label: "Original hire", type: "date" as const }, { key: "start_date", label: "Employment start", type: "date" as const }];
  return {
    kpis: [{ label: "Employees (master)", value: N(rows.length) }, { label: `Active ${c.asOf}`, value: N(active.length), tone: "good" },
      { label: "New hires in period", value: N(hires.length) }, { label: "Leavers in period", value: N(leavers.length), tone: leavers.length ? "warn" : undefined }],
    tables: [
      { title: "New hires", sub: `${c.from} – ${c.to}`, rows: hires, cols, maxHeight: 320 },
      { title: "Terminations / resignations", sub: `${c.from} – ${c.to}`, rows: leavers, cols: [...cols, { key: "left_on", label: "Left on", type: "date" }, { key: "termination_reason", label: "Reason" }], maxHeight: 320 },
      { title: "Employee master file", rows: rows.map((r) => ({ ...r, left_on: leave(r) })), cols: [...cols, { key: "left_on", label: "End / termination", type: "date" }, { key: "termination_reason", label: "Reason" }] },
    ],
  };
} };

export const EE_MODULE: ModuleDef = {
  key: "ee", title: "EE Cable Accessories", sub: "Initial requirements list: tracker and the reports built for it",
  reports: [tracker, vendors, polog, openpo, coverage, hr],
};
