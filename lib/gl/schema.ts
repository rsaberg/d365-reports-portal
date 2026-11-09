import { sql } from "../db";

/**
 * General ledger store (schema gl), created on first use so existing deployments need no migration step.
 * - ledgers   : company ↔ D365 ledger, accounting and reporting currency
 * - accounts  : main accounts (chart of accounts is shared by the companies)
 * - periods   : fiscal periods with their type (Opening / Operating / Closing)
 * - dimsets   : ledger dimension combinations → dimension values
 * - headers   : one row per general journal entry (voucher), Current posting layer
 * - lines     : voucher lines aggregated per voucher × main account × dimension combination × sign
 * - mbal      : monthly balances per company × account × period type (materialized view)
 * - budget    : budget entered in the portal (D365 has no budget register entries)
 */
export const GL_DDL = `
create schema if not exists gl;
create table if not exists gl.ledgers (recid bigint primary key, company text not null unique, name text, acc_cur text, rep_cur text);
create table if not exists gl.accounts (recid bigint primary key, account text not null unique, name text, type text, category text);
create table if not exists gl.periods (recid bigint primary key, name text, start_date date, end_date date, type text);
create table if not exists gl.dimsets (recid bigint primary key, dims jsonb not null default '{}');
create table if not exists gl.headers (
  recid bigint primary key, company text not null, acc_date date not null, ptype char(1) not null default 'O',
  voucher text, journal text, category text, doc text);
drop index if exists gl.gl_headers_co_date;
drop index if exists gl.gl_headers_voucher;
create table if not exists gl.lines (
  hdr bigint not null, company text not null, acc_date date not null, ptype char(1) not null,
  account text not null, dimset bigint, amt numeric(20,2) not null, rep numeric(20,2) not null);
create index if not exists gl_lines_co_acc_date on gl.lines (company, account, acc_date);
create index if not exists gl_lines_hdr on gl.lines (hdr);
create table if not exists gl.orphans (key bigint primary key, hdr bigint not null, account text not null, dimset bigint, amt numeric(20,2) not null, rep numeric(20,2) not null);
create table if not exists gl.sync_state (step text primary key, cursor bigint not null default 0, rows bigint not null default 0, total bigint, updated_at timestamptz not null default now());
create table if not exists gl.budget (company text not null, account text not null, month date not null, amount numeric(20,2) not null, primary key (company, account, month));
do $$ begin
  if exists (select 1 from pg_matviews where schemaname = 'gl' and matviewname = 'mbal')
     and not exists (select 1 from pg_attribute where attrelid = 'gl.mbal'::regclass and attname = 'rdr') then
    drop materialized view gl.mbal;
  end if;
  if not exists (select 1 from pg_matviews where schemaname = 'gl' and matviewname = 'mbal') then
    create materialized view gl.mbal as
      select company, date_trunc('month', acc_date)::date as month, ptype, account,
        coalesce(sum(amt) filter (where amt > 0), 0) as dr, coalesce(-sum(amt) filter (where amt < 0), 0) as cr,
        coalesce(sum(rep) filter (where rep > 0), 0) as rdr, coalesce(-sum(rep) filter (where rep < 0), 0) as rcr,
        sum(amt) as amt, sum(rep) as rep
      from gl.lines group by 1, 2, 3, 4;
    create unique index gl_mbal_key on gl.mbal (company, month, ptype, account);
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema gl from anon, authenticated;
    revoke all on all tables in schema gl from anon, authenticated;
  end if;
end $$;
`;

let ready = false;
export async function ensureGl() {
  if (ready) return;
  await sql.unsafe(GL_DDL);
  ready = true;
}
