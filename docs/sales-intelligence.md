# ONE365 Sales Intelligence: integration notes

The module is built inside the existing D365 Reports Portal. It reuses the portal's auth, sessions, company access, sidebar, Arabic translator, DataTable/Excel export and Supabase Postgres. Only these existing files were edited: `lib/nav.ts`, `components/Sidebar.tsx`, `components/Translator.tsx`, `app/globals.css` and `package.json`.

## Integration plan (spec phase A)

| Spec need | Existing portal piece reused | Added |
|---|---|---|
| Auth, roles, RLS | `lib/auth.ts`: admin / manager / sales roles, `portal.user_companies`, sales users pinned to `personnel_number` | `lib/si/scope.ts`: SI company access and the pinned salesperson, applied to every query |
| D365 data | `d365.*` tables filled by the existing sync and cron | `projectFromD365()` projects them into the `si` star schema. It reads only and never writes to D365 |
| Demo | `lib/reports/demo.ts` auto-create pattern | `lib/si/demo.ts`: deterministic company `dat`, plus an empty `dat2` for isolation tests |
| UI shell | Sidebar modules, `DataTable`, `Donut`, tokens, RTL translator | `components/si/*`: navy hero, filter bar, metric cards and charts (trend, bridge, heat map, funnel, Pareto, rank) |
| API | Next.js route handlers | `GET /api/analytics/sales/{kpis, catalog, screen/<slug>}`: read-only, session-scoped, audited |

## Architecture

```
d365.* (synced)      ─┐
                       ├─► si.* star schema (db/si.sql) ─► lib/si/query.ts (one event layer per measure)
demo generator (dat) ─┘                                   ─► lib/si/metrics.ts (180-KPI catalog, 121 computed)
                                                          ─► lib/si/screens.tsx ─► /si/* pages + /api/analytics/sales/*
```

- **Facts keep their legal grain:**
  - `si.order_line`: date roles are created and confirmed.
  - `si.slip_line`: date role is the delivery date.
  - `si.invoice_line`: the GOLD fact, dated by invoice date.
  - `si.ar_trans` and `si.settlement`: dated by the settlement date.
  - `si.target`: versioned, and only the approved version counts.
- **Net Sales** = `si.invoice_line.net_mst`, signed, ex-VAT, in the accounting currency.
  - Foreign-currency D365 lines without an FX source keep `net_mst` NULL.
  - They are listed on Reconciliation and never summed naively.
- **Snapshots** (backlog, delivered-not-invoiced, AR, credit exposure) are rebuilt as of the period end from event history. They are never summed across days.
- **Time engine** (`lib/si/time.ts`) supports:
  - fiscal year start month, week start, weekend days and holidays;
  - MTD, QTD and YTD;
  - comparable elapsed calendar or trading days;
  - 29 Feb mapping to 28 Feb;
  - same-weekday daily comparison.
- **Price/volume/mix bridge**: item-level fixed-order attribution with volume, mix, price, new SKUs, lost SKUs and allowances. The residual is asserted to be 0.00.

## Screens (`/si/...`)

| Route | Spec screen |
|---|---|
| `/si` | 01 Executive command center |
| `/si/daily` | 02 Daily |
| `/si/weekly` | 03 Weekly |
| `/si/monthly` | 04 Monthly |
| `/si/quarterly` | 05 Quarterly |
| `/si/yearly` | 06 Yearly |
| `/si/pvm` | 07 Revenue and growth decomposition |
| `/si/targets` | 08 Actual vs target |
| `/si/orders` | 10–12 Orders and backlog |
| `/si/fulfilment` | 13–14 Delivery and unbilled |
| `/si/invoices` | 15 Invoices and credits |
| `/si/customer?c=` | 16 Customer 360 |
| `/si/customers` | 18–19 Customers |
| `/si/products` | 20–21 Products |
| `/si/pricing` | 22 Pricing and discounts |
| `/si/margin` | 23–24 Margin |
| `/si/team` | 25–26 Team and territory |
| `/si/returns` | 27 Returns and credits |
| `/si/ar` | 28–29 Receivables and credit |
| `/si/recon` | 34 Reconciliation |
| `/si/kpis` | Metric dictionary, with live values |
| `/si/reports` | 170-report library and gap log |
| `/si/health` | Connection health, setup and audit |

**Every screen shares:**
- company, grain, as-of, comparison, basis and to-date/full-period controls;
- dimension filter chips;
- a DEMO DATA badge on demo companies;
- an open/closed period badge;
- Excel export on each table;
- a definitions footnote.

**Drill-through:** chart bars open the next grain, ranking rows add a filter, and customer names open Customer 360.

## Status (honest gap log)

The status of every item is generated into `lib/si/catalog.ts` and shown on `/si/kpis` and `/si/reports`.

| | IMPLEMENTED | DEMO ONLY | BLOCKED BY SOURCE | NOT BUILT |
|---|---|---|---|---|
| KPIs (180) | 120 | 2 | 20 | 38 |
| Reports (170) | 94 | 1 | 28 | 47 |

**Not built in this release:**
- Quotations analytics (the existing `/sales/quotations` report still works)
- Inventory / ATP analytics
- AI forecasting, anomalies and churn
- RFM and cohort retention
- FX-neutral growth
- Saved views and alert rules
- PDF board pack
- Custom report builder

**Blocked by source:**
- Van sales (dispatch integration off)
- Promotions, trade agreements and rebates
- Order change log
- Return order dates
- Disputes and write-offs

## CONNECTED_D365 mode: what the synced entities do and do not give

Run it from `/si/health → Build Sales Intelligence data` (admin), after a D365 sync.

**Works:**
- invoices and credits (net, discount, VAT, customer, rep, territory);
- orders (intake, backlog by remaining quantity);
- customer transactions;
- targets from `portal.targets`.

**Blocked until extra entities are synced:**
- COGS and margin: needs a cost source. They show N/A and are never estimated.
- Packing slips: needs `CustPackingSlipTrans`. Delivered, OTIF and unbilled stay empty.
- Settlement history: needs `CustSettlement`. Past as-of AR is approximate until then.

## Run and test

```bash
npm run db:migrate                    # existing schema; the si schema is created on first visit to /si
npm run test:si                       # 18 unit tests + 11 database tests (needs DATABASE_URL)
```

The database tests check:
- demo load equals the generator;
- `dat2` is isolated;
- every implemented KPI is computed;
- day/month/quarter/year totals tie out;
- as-of AR and backlog;
- the bridge residual is 0;
- a sales user only sees their own data;
- the approved target version is used;
- all reconciliation controls pass;
- the D365 projection equals the source.

**Last local run** (Postgres 17, 11 Nov 2026):
- all 29 tests pass;
- `next build` passes;
- all 23 `/si` screens render with HTTP 200 in about 1–2 s each on the demo dataset;
- the Arabic RTL layout at 390 px has no horizontal scroll.

## Known limits

- **Arabic:** labels come from `lib/i18n/ar-si.json`. Dynamic sentences such as notes and period labels stay in English.
- **Demo targets and cost:** these are generated, and the demo company is labelled DEMO everywhere.
- **Performance:** queries run on the transactional tables; there are no materialised aggregates yet. This is fine for the demo volume (about 11k invoice lines). Add daily aggregates before loading multi-million-line tenants.
