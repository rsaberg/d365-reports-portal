-- ONE365 Sales Intelligence — semantic model (spec §9.3, §9.5). Idempotent.
-- Facts keep their legal grain; nothing joins header-to-line-to-slip raw. Every row carries company + source lineage.
create schema if not exists si;

-- ---------- Control plane ----------
create table if not exists si.company (
  company text primary key,                -- DataAreaId
  tenant text not null default 'DEMO',
  name text not null,
  currency text not null,                  -- accounting currency
  fiscal_start_month int not null default 1 check (fiscal_start_month between 1 and 12),
  week_start int not null default 6,       -- 0=Sun … 6=Sat
  weekend int[] not null default '{5}',    -- Fri
  timezone text not null default 'Africa/Cairo',
  mode text not null default 'DEMO' check (mode in ('DEMO','CONNECTED_D365')),
  data_as_of date,                         -- DEMO: fixed snapshot date; CONNECTED: last complete business date
  active boolean not null default true
);
create table if not exists si.holiday (company text not null, date date not null, name text, primary key (company, date));

create table if not exists si.metric (
  metric_id text primary key, domain text not null, label_en text not null, label_ar text, definition text not null,
  unit text not null, aggregation text not null, event_layer text not null, date_role text not null,
  status text not null, version text not null default 'sales-kpi-v1', owner text default 'Finance'
);

create table if not exists si.report_def (
  report_id text primary key, domain text not null, name text not null, question text, grain text, route text, status text not null
);

create table if not exists si.saved_view (
  id bigserial primary key, user_id bigint not null, name text not null, route text not null, query jsonb not null,
  shared boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists si.audit (
  id bigserial primary key, at timestamptz not null default now(), user_id bigint, action text not null, target text, detail jsonb
);

create table if not exists si.sync_health (
  company text not null, entity text not null, last_success timestamptz, watermark text, rows int default 0,
  latency_min int, status text not null, message text, primary key (company, entity)
);

-- ---------- Dimensions ----------
create table if not exists si.territory (company text, code text, name text, region text, primary key (company, code));
create table if not exists si.channel (company text, code text, name text, primary key (company, code));
create table if not exists si.warehouse (company text, code text, name text, site text, territory text, primary key (company, code));
create table if not exists si.salesperson (company text, code text, name text, team text, territory text, manager text, primary key (company, code));
create table if not exists si.customer (
  company text, account text, name text, invoice_account text, cust_group text, segment text, tier text, parent text,
  territory text, channel text, city text, credit_limit numeric, terms_days int, currency text, first_seen date,
  primary key (company, account)
);
create table if not exists si.product (
  company text, item text, name text, category text, brand text, item_group text, uom text, units_per_box numeric,
  list_price numeric, std_cost numeric, primary key (company, item)
);
create table if not exists si.fx_rate (from_cur text, to_cur text, date date, rate numeric, primary key (from_cur, to_cur, date));

-- ---------- Facts ----------
-- Order line (event dates kept; backlog is derived as-of from slips + cancellations, never summed across days)
create table if not exists si.order_line (
  company text not null, order_id text not null, line_no int not null, customer text, invoice_account text,
  created date not null, confirmed date, requested_ship date, confirmed_ship date, item text, qty numeric, price numeric,
  discount_pct numeric, net_amount numeric, currency text, net_mst numeric, salesperson text, channel text, warehouse text,
  status text, cancelled_qty numeric default 0, cancelled_date date, hold text,
  source_key text, primary key (company, order_id, line_no)
);
create index if not exists si_ol_created on si.order_line (company, created);

create table if not exists si.slip_line (
  company text not null, slip_id text not null, order_id text not null, line_no int not null, delivery_date date not null,
  qty numeric, value_mst numeric, warehouse text, source_key text, primary key (company, slip_id, order_id, line_no)
);
create index if not exists si_sl_date on si.slip_line (company, delivery_date);

-- GOLD invoice line fact (spec §9.5). net_* = canonical Net Sales numerator, ex-VAT, signed.
create table if not exists si.invoice_line (
  company text not null, invoice_line_key text not null, invoice_id text not null, invoice_date date not null,
  order_id text, order_line int, slip_id text, customer text, invoice_account text, item text, uom text,
  qty numeric, price numeric, gross numeric, discount numeric, net numeric, tax numeric, cogs numeric, cogs_restated numeric,
  currency text, fx_rate numeric, net_mst numeric, gross_mst numeric, discount_mst numeric, cogs_mst numeric, cogs_restated_mst numeric,
  salesperson text, territory text, channel text, warehouse text,
  doc_type text not null check (doc_type in ('invoice','credit')), credit_class text, return_reason text, original_invoice_line_key text,
  source_key text, sync_batch text, primary key (company, invoice_line_key)
);
create index if not exists si_il_date on si.invoice_line (company, invoice_date);
create index if not exists si_il_cust on si.invoice_line (company, customer);
create index if not exists si_il_item on si.invoice_line (company, item);

create table if not exists si.ar_trans (
  company text not null, trans_id text not null, customer text, doc_type text, doc_id text, trans_date date, due_date date,
  amount numeric, primary key (company, trans_id)
);
create table if not exists si.settlement (
  company text not null, settle_id text not null, debit_trans text, credit_trans text, settle_date date, amount numeric,
  reversed_date date, primary key (company, settle_id)
);
create index if not exists si_st_debit on si.settlement (company, debit_trans);

create table if not exists si.target (
  company text not null, version int not null, status text not null, salesperson text not null, month date not null,
  amount numeric not null, primary key (company, version, salesperson, month)
);

-- ---------- Lineage / as-of lookup indexes ----------
create index if not exists si_sl_line on si.slip_line (company, order_id, line_no);
create index if not exists si_il_order on si.invoice_line (company, order_id, order_line);
create index if not exists si_il_orig on si.invoice_line (company, original_invoice_line_key);
create index if not exists si_st_credit on si.settlement (company, credit_trans);
create index if not exists si_ar_date on si.ar_trans (company, trans_date);
create index if not exists si_ol_ship on si.order_line (company, confirmed_ship);
