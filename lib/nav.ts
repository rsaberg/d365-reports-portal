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
/** Module menus: each module and the reports under it (keys match lib/reports/modules.ts). */
export const MODULE_NAV: { href: string; title: string; items: [string, string][] }[] = [
  { href: "/m/executive", title: "Executive overview", items: [["overview", "Overview"]] },
  { href: "/m/receivables", title: "Receivables", items: [["overview", "Overview"], ["balances", "Customer balances"], ["overdue", "Overdue invoices"], ["credit", "Credit limit use"], ["payments", "Customer payments"]] },
  { href: "/m/purchasing", title: "Purchasing", items: [["overview", "Overview"], ["open", "Open purchase orders"], ["register", "Purchase register"], ["price", "Purchase price history"], ["delivery", "Vendor delivery performance"], ["receipts", "Pending receipts"]] },
  { href: "/m/payables", title: "Payables", items: [["aging", "Vendor aging"], ["statement", "Vendor statement"], ["due", "Payments due"], ["payments", "Vendor payments"]] },
  { href: "/m/inventory", title: "Inventory", items: [["overview", "Overview"], ["onhand", "On-hand by site & warehouse"], ["valuation", "Inventory valuation"], ["movement", "Item movement"], ["slow", "Slow-moving & dead stock"], ["reorder", "Below reorder point"], ["turnover", "Inventory turnover"], ["batch", "Batch & expiry"]] },
  { href: "/m/warehouse", title: "Warehouse", items: [["shipments", "Open shipments & picking"], ["receipts", "Receipts register"], ["transit", "Transfers in transit"]] },
  { href: "/m/production", title: "Production", items: [["overview", "Overview"], ["status", "Production order status"], ["output", "Output vs plan"], ["material", "Material consumption vs BOM"], ["late", "Late production orders"]] },
  { href: "/m/cash", title: "Cash & bank", items: [["balances", "Bank balances"], ["transactions", "Bank transactions"], ["forecast", "Cash forecast"]] },
  { href: "/m/assets", title: "Fixed assets", items: [["register", "Fixed asset register"], ["depreciation", "Depreciation schedule"], ["movements", "Acquisitions & disposals"]] },
];
