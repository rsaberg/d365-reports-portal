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
export const MODULE_NAV = [
  { href: "/m/executive", title: "Executive overview" },
  { href: "/m/receivables", title: "Receivables" },
  { href: "/m/purchasing", title: "Purchasing" },
  { href: "/m/payables", title: "Payables" },
  { href: "/m/inventory", title: "Inventory" },
  { href: "/m/warehouse", title: "Warehouse" },
  { href: "/m/production", title: "Production" },
  { href: "/m/cash", title: "Cash & bank" },
  { href: "/m/assets", title: "Fixed assets" },
];
