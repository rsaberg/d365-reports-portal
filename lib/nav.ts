export const SALES_REPORTS = [
  { href: "/sales/performance", title: "Sales Performance", desc: "Net sales by period, customer, category and item" },
  { href: "/sales/invoices", title: "Invoice Register", desc: "Every posted invoice and credit note" },
  { href: "/sales/open-orders", title: "Open Sales Orders", desc: "Backlog by ship date, late lines, stock cover" },
  { href: "/sales/aging", title: "Customer Aging", desc: "Open receivables by days past due" },
  { href: "/sales/statement", title: "Statement & Collections", desc: "Opening, invoiced, collected, closing per customer" },
  { href: "/sales/salesperson", title: "Sales by Salesperson", desc: "Actual vs target per salesperson" },
  { href: "/sales/discounts", title: "Discount Analysis", desc: "Discounts by customer, item and price variance" },
  { href: "/sales/returns", title: "Returns", desc: "Return orders, reasons and dispositions" },
  { href: "/sales/quotations", title: "Quotations", desc: "Quoted value, status and win rate" },
  { href: "/sales/delivery", title: "Delivery Schedule", desc: "What ships when, and stock shortages" },
] as const;
export const ADMIN = [
  { href: "/admin/users", title: "Users & access" },
  { href: "/admin/targets", title: "Sales targets" },
  { href: "/admin/settings", title: "Settings" },
  { href: "/admin/sync", title: "Data sync" },
];
