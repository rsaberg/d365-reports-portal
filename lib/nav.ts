export const SALES_REPORTS = [
  { href: "/sales/performance", title: "Sales Performance", desc: "Net sales by period, customer, category and item" },
  { href: "/sales/invoices", title: "Invoice Register", desc: "Every posted invoice and credit note" },
  { href: "/sales/open-orders", title: "Open Sales Orders", desc: "Backlog by ship date, late lines, stock cover" },
  { href: "/sales/aging", title: "Customer Aging", desc: "Open receivables by days past due" },
  { href: "/sales/statement", title: "Statement & Collections", desc: "Opening, invoiced, collected, closing per customer" },
  { href: "/sales/payments", title: "Invoice Payment Status", desc: "Paid, unpaid, remaining amount and days per invoice" },
  { href: "/m/margin", title: "Sales Margin", desc: "Sales, cost and gross profit per item and customer" },
  { href: "/sales/salesperson", title: "Sales by Salesperson", desc: "Actual vs target per salesperson" },
  { href: "/sales/discounts", title: "Discount Analysis", desc: "Discounts by customer, item and price variance" },
  { href: "/sales/returns", title: "Returns", desc: "Return orders, reasons and dispositions" },
  { href: "/sales/quotations", title: "Quotations", desc: "Quoted value, status and win rate" },
  { href: "/sales/delivery", title: "Delivery Schedule", desc: "What ships when, and stock shortages" },
] as const;
export const ADMIN = [
  { href: "/admin/users", title: "Users & access" },
  { href: "/admin/targets", title: "Sales targets" },
  { href: "/admin/statements", title: "Statement layout" },
  { href: "/admin/settings", title: "Settings" },
  { href: "/admin/d365", title: "D365 integration" },
  { href: "/admin/sync", title: "Data sync" },
];
export const FINANCE = [
  { href: "/finance", title: "Financial overview" },
  { href: "/finance/income", title: "Income statement" },
  { href: "/finance/balance", title: "Balance sheet" },
  { href: "/finance/cashflow", title: "Cash flow" },
  { href: "/finance/trial", title: "Trial balance" },
  { href: "/finance/ratios", title: "Financial ratios" },
  { href: "/finance/budget", title: "Budget vs actual" },
  { href: "/finance/vouchers", title: "Voucher search" },
];
export const OPS = [
  { href: "/ops", title: "Transaction tracking" },
  { href: "/ops/documents", title: "Document lifecycle" },
  { href: "/ops/users", title: "User activity" },
  { href: "/ops/expected", title: "Expected vs entered" },
];
type Item = { href: string; label: string };
const eeItems = (items: [string, string][]): Item[] => [{ href: "/m/ee", label: "Requirements tracker" }, ...items.map(([r, label]) => ({ href: `/m/ee?r=${r}`, label }))];
const mod = (key: string, items: [string, string][]): Item[] => [{ href: `/m/${key}`, label: "Dashboard" }, ...items.map(([r, label]) => ({ href: `/m/${key}?r=${r}`, label }))];
/** The whole sidebar is modules: each one opens on its dashboard and lists its reports under it.
 *  `managers` modules are hidden from the sales role. */
export const NAV_MODULES: { key: string; title: string; managers?: boolean; admins?: boolean; items: Item[] }[] = [
  { key: "si", title: "Sales Intelligence", items: [
    { href: "/si", label: "Command center" }, { href: "/si/daily", label: "Daily" }, { href: "/si/weekly", label: "Weekly" }, { href: "/si/monthly", label: "Monthly" },
    { href: "/si/quarterly", label: "Quarterly" }, { href: "/si/yearly", label: "Yearly" }, { href: "/si/pvm", label: "Growth bridge" }, { href: "/si/targets", label: "Actual vs target" },
    { href: "/si/orders", label: "Orders & backlog" }, { href: "/si/fulfilment", label: "Delivery & unbilled" }, { href: "/si/invoices", label: "Invoices & credits" },
    { href: "/si/customers", label: "Customers" }, { href: "/si/products", label: "Products" }, { href: "/si/pricing", label: "Pricing & discounts" }, { href: "/si/margin", label: "Margin" },
    { href: "/si/team", label: "Team & territory" }, { href: "/si/returns", label: "Returns & credits" }, { href: "/si/ar", label: "Receivables & credit" },
    { href: "/si/recon", label: "Reconciliation" }, { href: "/si/kpis", label: "Metric dictionary" }, { href: "/si/reports", label: "Report library" }, { href: "/si/health", label: "Connection health" },
  ] },
  { key: "executive", title: "Executive", managers: true, items: [{ href: "/m/executive", label: "Dashboard" }] },
  { key: "sales", title: "Sales", items: [{ href: "/", label: "Dashboard" }, ...SALES_REPORTS.map((r) => ({ href: r.href, label: r.title }))] },
  { key: "receivables", title: "Receivables", managers: true, items: mod("receivables", [["balances", "Customer balances"], ["overdue", "Overdue invoices"], ["credit", "Credit limit use"], ["payments", "Customer payments"]]) },
  { key: "purchasing", title: "Purchasing", managers: true, items: mod("purchasing", [["open", "Open purchase orders"], ["register", "Purchase register"], ["price", "Purchase price history"], ["delivery", "Vendor delivery performance"], ["receipts", "Pending receipts"]]) },
  { key: "payables", title: "Payables", managers: true, items: mod("payables", [["aging", "Vendor aging"], ["statement", "Vendor statement"], ["due", "Payments due"], ["payments", "Vendor payments"]]) },
  { key: "inventory", title: "Inventory", managers: true, items: mod("inventory", [["stockmove", "Inventory movement (D365)"], ["aging", "Inventory aging (D365)"], ["onhand", "On-hand by site & warehouse"], ["valuation", "Inventory valuation"], ["movement", "Item movement"], ["slow", "Slow-moving & dead stock"], ["reorder", "Below reorder point"], ["turnover", "Inventory turnover"], ["batch", "Batch & expiry"]]) },
  { key: "warehouse", title: "Warehouse", managers: true, items: mod("warehouse", [["shipments", "Open shipments & picking"], ["receipts", "Receipts register"], ["transit", "Transfers in transit"]]) },
  { key: "production", title: "Production", managers: true, items: mod("production", [["status", "Production order status"], ["output", "Output vs plan"], ["material", "Material consumption vs BOM"], ["late", "Late production orders"]]) },
  { key: "cost", title: "Cost accounting", managers: true, items: mod("cost", [["items", "Item cost list"], ["cogs", "Cost of sales by item"], ["ppv", "Purchase price variance"], ["production", "Production order costing"], ["groups", "Cost by item group"]]) },
  { key: "cash", title: "Cash & bank", managers: true, items: mod("cash", [["balances", "Bank balances"], ["transactions", "Bank transactions"], ["forecast", "Cash forecast"]]) },
  { key: "assets", title: "Fixed assets", managers: true, items: mod("assets", [["register", "Fixed asset register"], ["depreciation", "Depreciation schedule"], ["movements", "Acquisitions & disposals"]]) },
  { key: "finance", title: "Finance", managers: true, items: FINANCE.map((r, i) => ({ href: r.href, label: i === 0 ? "Dashboard" : r.title })) },
  { key: "security", title: "User security", managers: true, admins: true, items: mod("security", [["users", "Users & roles"], ["roles", "Roles & members"], ["privileged", "Privileged access"], ["sod", "Segregation of duties"], ["licenses", "Licences"]]) },
  { key: "ee", title: "EE Cable Accessories", managers: true, items: eeItems( [["vendors", "Vendor master file"], ["polog", "PR / PO log"], ["openpo", "Open POs not delivered"], ["coverage", "Min / max, safety stock & lead time"], ["hr", "Employees: master, hires, leavers"]]) },
  { key: "transactions", title: "Transactions", managers: true, items: [{ href: "/m/transactions", label: "Dashboard" }, ...OPS.map((r) => ({ href: r.href, label: r.title }))] },
];
