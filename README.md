# D365 Reports Portal

Sales reporting and analysis on top of Dynamics 365 Finance & Operations.
Next.js 14 · Postgres (Supabase) · D365 OData sync · users and roles managed in the portal.

## How it works

```
D365 F&O ──OData (Entra app, read-only)──▶ sync job ──▶ Postgres (d365.* tables) ──▶ report pages
                                         daily + "Sync now"             portal.* tables: users, companies, targets, settings
```

The portal reads a **copy** of D365 data. Reports are SQL over that copy, so they are fast, can aggregate freely,
and put no load on D365. Field names in `lib/d365/entities.ts` were verified against a live environment's `$metadata`.

## What's in the first release (Sales)

| Page | What it shows | D365 source |
|---|---|---|
| Sales dashboard | Net sales vs last year, invoices, customers, open orders, receivables, top customers/items/categories | invoice headers + lines, open order lines, customer transactions |
| Sales Performance | Net sales by customer, item, category, customer group or month, with growth | `SalesInvoiceV4Lines`, `SalesInvoiceHeadersV4` |
| Invoice Register | Every invoice/credit note, drill into lines | `SalesInvoiceHeadersV4`, `SalesInvoiceV4Lines` |
| Open Sales Orders | Backlog by ship date, days late, stock check | `SalesOrderLinesV3` (status Open order), `SalesOrderHeadersV4`, `InventorySitesOnHandV2` |
| Customer Aging | Open items in configurable buckets (default 10), as-of date, due/transaction basis, drill to items | `CustTransactions` (open = `Closed` empty) |
| Statement & Collections | Opening / invoiced / collected / closing per customer, statement with running balance | `CustTransactions` |
| Sales by Salesperson | Actual vs target, growth, avg invoice | invoice responsible person + portal targets |
| Discount Analysis | Line discounts by customer, lines priced > 5% under the item's average | `SalesInvoiceV4Lines` |
| Returns | RMAs, reasons, returned items | `ReturnOrderHeadersV2`, `ReturnOrderLinesV2` |
| Quotations | Pipeline, won/lost, win rate | `SalesQuotationHeadersV2`, `SalesQuotationLines` |
| Delivery Schedule | What ships each week, overdue lines, stock shortages | open order lines + on-hand |

Every table sorts by column and exports to Excel. Filters (company, period, currency, customer group) carry across reports.

**Roles:** Admin (everything + administration) · Manager (all reports for assigned companies) · Sales (only invoices/orders/customers
where they are the responsible person, in assigned companies).

### Known gaps that need custom D365 entities
- **Remaining quantity** on open order lines (standard entity only has ordered qty) → Open Orders values partly-delivered lines at full qty.
- **Shipped-not-invoiced packing slips** (no standard packing-slip entity).
- **Cost of sales / margin** (invoice line entities carry no cost).
- **Trade agreement price check** (add `SalesPriceAgreements` to the sync).

## Setup

1. **Database (Supabase):** create a project, copy the connection string into `DATABASE_URL`, then
   `npm install && npm run db:migrate`.
2. **First admin:** `npm run db:seed-admin -- you@company.com "Your Name" "a-strong-password"`.
3. **D365 connection:**
   - Entra ID → App registrations → new app → create a client secret.
   - In D365: *System administration > Setup > Microsoft Entra applications* → add the Client ID, map it to a user with
     **read-only** access to the entities above.
   - Fill `D365_URL`, `D365_TENANT_ID`, `D365_CLIENT_ID`, `D365_CLIENT_SECRET`, `SYNC_COMPANIES`.
   - First load: `npm run sync -- usmf,demf --full`, or *Administration > Data sync* in the portal.
4. **Run:** `npm run dev` (local) or deploy to Vercel (set the same env vars + `CRON_SECRET`; `vercel.json` schedules the sync daily at 03:00 UTC — Vercel Hobby allows one cron run a day; use Pro for every 2 hours).

### Demo without a D365 connection
`npm run load:snapshot` loads `snapshot/` — a copy of USMF and DEMF exported from the Grow Path demo environment
(row counts and totals verified against D365).

## Project layout
```
app/(portal)/            dashboard, sales/*, admin/*
app/login                sign-in
app/api/cron/sync        scheduled sync endpoint
lib/d365/entities.ts     entity → table mapping (add entities here)
lib/d365/odata.ts        OData client (token, paging, cross-company)
lib/d365/sync.ts         sync runner
lib/reports/*.ts         report SQL
db/schema.sql            tables + reporting view
```
