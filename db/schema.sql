-- D365 Reports Portal schema. Safe to run more than once.
create schema if not exists d365;
create schema if not exists portal;

-- ---------- Data synced from D365 F&O (one row per D365 record, per company) ----------
create table if not exists d365.companies (
  company text primary key,
  name text,
  currency text
);

create table if not exists d365.customers (
  company text not null, account text not null, name text, cust_group text, credit_limit numeric default 0,
  payment_terms text, currency text, sales_district text, segment text, responsible text, city text, country text,
  primary key (company, account)
);

create table if not exists d365.workers (
  personnel_number text primary key, name text
);

create table if not exists d365.invoice_headers (
  id bigserial primary key, company text not null, invoice text not null, invoice_date date not null,
  customer text, sales_order text, responsible text, currency text,
  total_amount numeric default 0, tax_amount numeric default 0, line_discount numeric default 0,
  end_discount numeric default 0, charges numeric default 0, payment_terms text, delivery_mode text, voucher text
);
create index if not exists ix_inv_hdr on d365.invoice_headers (company, invoice_date);
create index if not exists ix_inv_hdr_inv on d365.invoice_headers (company, invoice);

create table if not exists d365.invoice_lines (
  id bigserial primary key, company text not null, invoice text not null, invoice_date date not null, line_seq int,
  item text, item_name text, category text, qty numeric default 0, unit text, price numeric default 0,
  line_amount numeric default 0, discount numeric default 0, tax numeric default 0, site text, warehouse text, currency text
);
create index if not exists ix_inv_lines on d365.invoice_lines (company, invoice_date);
create index if not exists ix_inv_lines_inv on d365.invoice_lines (company, invoice);

create table if not exists d365.cust_trans (
  company text not null, rec_id bigint not null, account text, voucher text, invoice text, trans_date date, due_date date,
  document_date date, trans_type int, amount_mst numeric default 0, amount_cur numeric default 0, settle_mst numeric default 0,
  currency text, closed date, last_settle_date date, paym_mode text, txt text,
  primary key (company, rec_id)
);
create index if not exists ix_cust_trans on d365.cust_trans (company, account, trans_date);

create table if not exists d365.order_headers (
  company text not null, sales_order text not null, customer text, invoice_account text, status int, created date,
  requested_ship date, confirmed_ship date, responsible text, currency text, delivery_mode text, customer_ref text, name text,
  primary key (company, sales_order)
);

create table if not exists d365.order_lines (
  id bigserial primary key, company text not null, sales_order text not null, line_number numeric, line_seq int,
  item text, description text, qty numeric default 0, unit text, price numeric default 0, discount_amount numeric default 0,
  discount_pct numeric default 0, line_amount numeric default 0, currency text, requested_ship date, confirmed_ship date,
  site text, warehouse text, status int, sales_group text, delivery_mode text
);
create index if not exists ix_order_lines on d365.order_lines (company, sales_order);

create table if not exists d365.onhand (
  id bigserial primary key, company text not null, item text not null, site text,
  available numeric default 0, physical numeric default 0, reserved numeric default 0
);
create index if not exists ix_onhand on d365.onhand (company, item);

create table if not exists d365.quotations (
  company text not null, quotation text not null, customer text, prospect text, name text, status int, expiry date,
  confirmed date, follow_up date, responsible text, sales_order text, total_amount numeric default 0,
  discount_amount numeric default 0, currency text, reason text, requested_date date,
  primary key (company, quotation)
);

create table if not exists d365.quotation_lines (
  id bigserial primary key, company text not null, quotation text not null, line_seq int, item text,
  qty numeric default 0, price numeric default 0, line_amount numeric default 0
);

create table if not exists d365.return_headers (
  company text not null, return_order text not null, rma text, customer text, invoice_account text, reason text,
  return_status int, order_status int, deadline date, replacement_order text, total_amount numeric default 0,
  currency text, warehouse text,
  primary key (company, return_order)
);

create table if not exists d365.return_lines (
  id bigserial primary key, company text not null, return_order text not null, line_number numeric, line_seq int, item text,
  return_qty numeric default 0, returned_qty numeric default 0, price numeric default 0, line_amount numeric default 0,
  disposition text, status int, expected_arrival date, actual_arrival date, closed date
);

create table if not exists d365.sync_runs (
  id bigserial primary key, started_at timestamptz not null default now(), finished_at timestamptz,
  source text not null, company text, entity text, rows int default 0, status text not null default 'running', error text
);

-- ---------- Portal data (owned by the portal, not D365) ----------
create table if not exists portal.users (
  id bigserial primary key, email text not null unique, name text not null, password_hash text not null,
  role text not null check (role in ('admin','manager','sales')), personnel_number text,
  active boolean not null default true, created_at timestamptz not null default now(), last_login timestamptz
);

create table if not exists portal.user_companies (
  user_id bigint not null references portal.users(id) on delete cascade, company text not null,
  primary key (user_id, company)
);

create table if not exists portal.settings (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);

create table if not exists portal.targets (
  id bigserial primary key, company text not null, personnel_number text not null, month date not null, amount numeric not null,
  unique (company, personnel_number, month)
);

insert into portal.settings (key, value) values
  ('aging_buckets', '[30,60,90,120,150,180,270,365]'),
  ('aging_basis', '"due"')
on conflict (key) do nothing;

-- ---------- Reporting views ----------
create or replace view d365.v_sales as
select l.*, h.customer, h.responsible, c.name as customer_name, c.cust_group, w.name as responsible_name
from d365.invoice_lines l
left join (select distinct on (company, invoice) company, invoice, customer, responsible
           from d365.invoice_headers order by company, invoice, id) h using (company, invoice)
left join d365.customers c on c.company = l.company and c.account = h.customer
left join d365.workers w on w.personnel_number = h.responsible;

-- Supabase: keep the portal schemas away from the public API roles (the app connects as the database owner).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema d365, portal from anon, authenticated;
    revoke all on all tables in schema d365, portal from anon, authenticated;
  end if;
end $$;
