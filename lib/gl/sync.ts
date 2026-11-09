import { sql } from "../db";
import { d365Token, getSetting, requireConfig, type D365Config } from "../d365/config";
import { ensureGl } from "./schema";

/**
 * General ledger sync from D365 BI entities, resumable and incremental:
 * every step reads rows with SourceKey (RecId) greater than its saved cursor, ordered by SourceKey, so a run can stop
 * at any page (request time limit) and the next run continues — and later runs only read what was posted since.
 */

export const GL_STEPS = ["master", "headers", "lines", "refresh"] as const;
export type GlStep = (typeof GL_STEPS)[number];

const PAGE = 10000;
const BUDGET_MS = 230_000;

async function get(c: D365Config, path: string): Promise<Record<string, unknown>[]> {
  const url = c.envUrl.replace(/\/$/, "") + "/data/" + path;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await d365Token(c)}`, Accept: "application/json", Prefer: `odata.maxpagesize=${PAGE}` } });
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get("retry-after")) || 5 * (attempt + 1)) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${path.split("?")[0]} failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { value: Record<string, unknown>[] }).value;
  }
  throw new Error(`${path.split("?")[0]}: D365 is throttling requests, try again in a minute`);
}
async function count(c: D365Config, path: string): Promise<number | null> {
  try {
    const url = c.envUrl.replace(/\/$/, "") + "/data/" + path + (path.includes("?") ? "&" : "?") + "$top=0&$count=true";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await d365Token(c)}`, Accept: "application/json" } });
    return res.ok ? Number(((await res.json()) as Record<string, unknown>)["@odata.count"]) : null;
  } catch {
    return null;
  }
}

const s = (v: unknown) => (v == null ? "" : String(v));
const day = (v: unknown) => s(v).slice(0, 10);

async function state(step: GlStep) {
  const [r] = await sql<{ cursor: string; rows: string; total: string | null }[]>`select cursor, rows, total from gl.sync_state where step = ${step}`;
  return { cursor: Number(r?.cursor ?? 0), rows: Number(r?.rows ?? 0), total: r?.total == null ? null : Number(r.total) };
}
async function save(step: GlStep, cursor: number, rows: number, total?: number | null) {
  await sql`insert into gl.sync_state (step, cursor, rows, total, updated_at) values (${step}, ${cursor}, ${rows}, ${total ?? null}, now())
    on conflict (step) do update set cursor = excluded.cursor, rows = excluded.rows, total = coalesce(excluded.total, gl.sync_state.total), updated_at = now()`;
}

/** Ledgers (company + currencies), main accounts and fiscal periods — small, reloaded in full. */
async function syncMaster(c: D365Config) {
  const ledgers = await get(c, "LedgerBiEntities?$select=SourceKey,Name,Description,AccountingCurrency,ReportingCurrency");
  for (const l of ledgers) {
    if (!s(l.Name) || !s(l.AccountingCurrency)) continue;
    await sql`insert into gl.ledgers (recid, company, name, acc_cur, rep_cur) values (${Number(l.SourceKey)}, ${s(l.Name).toLowerCase()}, ${s(l.Description)}, ${s(l.AccountingCurrency)}, ${s(l.ReportingCurrency) || null})
      on conflict (recid) do update set company = excluded.company, name = excluded.name, acc_cur = excluded.acc_cur, rep_cur = excluded.rep_cur`;
  }
  const accounts = await get(c, "MainAccounts?$select=MainAccountRecId,MainAccountId,Name,MainAccountType,MainAccountCategory");
  if (accounts.length) {
    const rows = accounts.map((a) => ({ recid: Number(a.MainAccountRecId), account: s(a.MainAccountId), name: s(a.Name), type: s(a.MainAccountType), category: s(a.MainAccountCategory) || null }));
    await sql`insert into gl.accounts ${sql(rows)} on conflict (recid) do update set account = excluded.account, name = excluded.name, type = excluded.type, category = excluded.category`;
  }
  const periods = await get(c, "FiscalCalendarPeriodBiEntities?$select=SourceKey,Name,StartDate,EndDate,Type");
  if (periods.length) {
    const rows = periods.map((p) => ({ recid: Number(p.SourceKey), name: s(p.Name), start_date: day(p.StartDate), end_date: day(p.EndDate), type: s(p.Type) }));
    await sql`insert into gl.periods ${sql(rows)} on conflict (recid) do update set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, type = excluded.type`;
  }
  await save("master", 0, accounts.length);
  return { done: true, rows: accounts.length, note: `${ledgers.length} ledgers · ${accounts.length} accounts · ${periods.length} periods` };
}

/** Voucher headers (GeneralJournalEntryBiEntities), Current layer. */
async function syncHeaders(c: D365Config, t0: number) {
  const ledgers = new Map((await sql<{ recid: string; company: string }[]>`select recid, company from gl.ledgers`).map((r) => [Number(r.recid), r.company]));
  const periods = new Map((await sql<{ recid: string; type: string }[]>`select recid, type from gl.periods`).map((r) => [Number(r.recid), r.type]));
  if (!ledgers.size) throw new Error("Run the master data step first");
  let { cursor, rows } = await state("headers");
  const layer = "PostingLayer eq Microsoft.Dynamics.DataEntities.CurrentOperationsTax'Current'";
  const total = rows + ((await count(c, `GeneralJournalEntryBiEntities?$filter=SourceKey gt ${cursor} and ${layer}`)) ?? 0);
  await save("headers", cursor, rows, total);
  while (Date.now() - t0 < BUDGET_MS) {
    const page = await get(c, `GeneralJournalEntryBiEntities?$select=SourceKey,Ledger,AccountingDate,FiscalCalendarPeriod,SubledgerVoucher,JournalNumber,JournalCategory,DocumentNumber&$filter=SourceKey gt ${cursor} and ${layer}&$orderby=SourceKey&$top=${PAGE}`);
    if (!page.length) return { done: true, rows, total };
    const recs = page.map((h) => {
      const type = periods.get(Number(h.FiscalCalendarPeriod)) ?? "Operating";
      return { recid: Number(h.SourceKey), company: ledgers.get(Number(h.Ledger)) ?? "?", acc_date: day(h.AccountingDate), ptype: type === "Opening" ? "P" : type === "Closing" ? "C" : "O",
        voucher: s(h.SubledgerVoucher), journal: s(h.JournalNumber), category: s(h.JournalCategory), doc: s(h.DocumentNumber) };
    });
    for (let i = 0; i < recs.length; i += 2000) {
      await sql`insert into gl.headers ${sql(recs.slice(i, i + 2000))} on conflict (recid) do update set company = excluded.company, acc_date = excluded.acc_date, ptype = excluded.ptype, voucher = excluded.voucher`;
    }
    cursor = recs[recs.length - 1].recid;
    rows += recs.length;
    await save("headers", cursor, rows);
    if (page.length < PAGE) return { done: true, rows, total };
  }
  return { done: false, rows, total };
}

/** Voucher lines (GeneralJournalAccountEntryBiEntities) → gl.lines, aggregated per voucher × account × dimensions × sign. */
async function syncLines(c: D365Config, t0: number) {
  const accounts = new Map((await sql<{ recid: string; account: string }[]>`select recid, account from gl.accounts`).map((r) => [Number(r.recid), r.account]));
  const { cursor: hdrCursor } = await state("headers");
  let { cursor, rows } = await state("lines");
  const total = rows + ((await count(c, `GeneralJournalAccountEntryBiEntities?$filter=SourceKey gt ${cursor}`)) ?? 0);
  await save("lines", cursor, rows, total);
  const knownDims = new Set<number>();
  let pages = 0;
  while (Date.now() - t0 < BUDGET_MS) {
    if (pages++ % 5 === 0) await checkRoom();
    const page = await get(c, `GeneralJournalAccountEntryBiEntities?$select=SourceKey,GeneralJournalEntry,MainAccount,LedgerDimension,LedgerDimensionValuesJson,AccountingCurrencyAmount,ReportingCurrencyAmount&$filter=SourceKey gt ${cursor}&$orderby=SourceKey&$top=${PAGE}`);
    if (!page.length) break;
    const agg = new Map<string, { hdr: number; account: string; dimset: number; amt: number; rep: number; key: number }>();
    const dims: { recid: number; dims: Record<string, string> }[] = [];
    for (const l of page) {
      const account = accounts.get(Number(l.MainAccount)) ?? `#${s(l.MainAccount)}`;
      const dimset = Number(l.LedgerDimension) || 0;
      const amt = Number(l.AccountingCurrencyAmount) || 0, rep = Number(l.ReportingCurrencyAmount) || 0;
      const k = `${l.GeneralJournalEntry}|${account}|${dimset}|${amt < 0 ? "c" : "d"}`;
      const a = agg.get(k);
      if (a) { a.amt += amt; a.rep += rep; }
      else agg.set(k, { hdr: Number(l.GeneralJournalEntry), account, dimset, amt, rep, key: Number(l.SourceKey) });
      if (dimset && !knownDims.has(dimset)) {
        knownDims.add(dimset);
        let d: Record<string, string> = {};
        try {
          for (const o of JSON.parse(s(l.LedgerDimensionValuesJson) || "[]") as Record<string, string>[]) for (const [k2, v] of Object.entries(o)) if (k2 !== "MAINACCOUNT" && v) d[k2] = String(v);
        } catch { d = {}; }
        dims.push({ recid: dimset, dims: d });
      }
    }
    const recs = [...agg.values()].map((r) => ({ ...r, amt: Math.round(r.amt * 100) / 100, rep: Math.round(r.rep * 100) / 100 }));
    const nextCursor = Number(page[page.length - 1].SourceKey);
    // One transaction per page: lines, orphans and the cursor move together, so an interrupted page is simply re-read.
    await sql.begin(async (tx) => {
      for (let i = 0; i < dims.length; i += 2000) {
        await tx`insert into gl.dimsets (recid, dims)
          select v.recid, v.dims from jsonb_to_recordset(${tx.json(dims.slice(i, i + 2000) as never)}) as v(recid bigint, dims jsonb)
          on conflict (recid) do nothing`;
      }
      for (let i = 0; i < recs.length; i += 5000) {
        const chunk = tx.json(recs.slice(i, i + 5000) as never);
        await tx`insert into gl.lines (hdr, company, acc_date, ptype, account, dimset, amt, rep)
          select v.hdr, h.company, h.acc_date, h.ptype, v.account, nullif(v.dimset, 0), v.amt, v.rep
          from jsonb_to_recordset(${chunk}) as v(hdr bigint, account text, dimset bigint, amt numeric, rep numeric, key bigint)
          join gl.headers h on h.recid = v.hdr`;
        // Lines whose voucher header is newer than the header sync wait in gl.orphans until the next run.
        await tx`insert into gl.orphans (key, hdr, account, dimset, amt, rep)
          select v.key, v.hdr, v.account, nullif(v.dimset, 0), v.amt, v.rep
          from jsonb_to_recordset(${chunk}) as v(hdr bigint, account text, dimset bigint, amt numeric, rep numeric, key bigint)
          where v.hdr > ${hdrCursor} and not exists (select 1 from gl.headers h where h.recid = v.hdr)
          on conflict (key) do nothing`;
      }
      await tx`insert into gl.sync_state (step, cursor, rows, updated_at) values ('lines', ${nextCursor}, ${rows + page.length}, now())
        on conflict (step) do update set cursor = excluded.cursor, rows = excluded.rows, updated_at = now()`;
    });
    cursor = nextCursor;
    rows += page.length;
    if (page.length < PAGE) break;
  }
  const done = Date.now() - t0 < BUDGET_MS;
  if (done) {
    // Orphans whose header has arrived since.
    await sql`with moved as (delete from gl.orphans o using gl.headers h where h.recid = o.hdr returning o.*, h.company, h.acc_date, h.ptype)
      insert into gl.lines (hdr, company, acc_date, ptype, account, dimset, amt, rep) select hdr, company, acc_date, ptype, account, dimset, amt, rep from moved`;
  }
  return { done, rows, total };
}

async function refresh() {
  await sql`refresh materialized view concurrently gl.mbal`;
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from gl.mbal`;
  return { done: true, rows: r.n };
}

/** Run one step for up to ~4 minutes. */
export async function runGlStep(step: GlStep) {
  await ensureGl();
  const c = await requireConfig();
  const t0 = Date.now();
  if (step === "master") return syncMaster(c);
  if (step === "headers") return syncHeaders(c, t0);
  if (step === "lines") return syncLines(c, t0);
  return refresh();
}

export async function glStatus() {
  await ensureGl();
  const steps = await sql<{ step: string; cursor: string; rows: string; total: string | null; updated_at: Date }[]>`select * from gl.sync_state order by step`;
  const [db] = await sql<{ size: string; gl: string }[]>`select pg_size_pretty(pg_database_size(current_database())) size,
    pg_size_pretty(coalesce((select sum(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'gl'), 0)) gl`;
  const companies = await sql<{ company: string; vouchers: number; first: Date | null; last: Date | null }[]>`
    select company, count(*)::int vouchers, min(acc_date) first, max(acc_date) last from gl.headers group by 1 order by 1`;
  const [orph] = await sql<{ n: number }[]>`select count(*)::int n from gl.orphans`;
  const tables = await sql<{ t: string; size: string }[]>`select c.relname t, pg_size_pretty(pg_total_relation_size(c.oid)) size
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'gl' and c.relkind in ('r', 'm') order by pg_total_relation_size(c.oid) desc`;
  const [srv] = await sql<{ sb: string; mc: string; bytes: string }[]>`select current_setting('shared_buffers') sb, current_setting('max_connections') mc, pg_database_size(current_database()) bytes`;
  return { steps, db: { ...db, mb: Math.round(Number(srv.bytes) / 1048576), limitMb: await dbLimitMb() }, companies, orphans: orph.n, tables, server: { sharedBuffers: srv.sb, maxConnections: srv.mc } };
}

/** Database size cap for the sync (MB): stops loading before a small plan's limit makes the shared database read-only. */
export async function dbLimitMb() {
  const v = Number(process.env.GL_DB_LIMIT_MB) || Number(await getSetting<number>("gl_db_limit_mb")) || 450;
  return v;
}
async function checkRoom() {
  const [r] = await sql<{ b: string }[]>`select pg_database_size(current_database()) b`;
  const mb = Number(r.b) / 1048576, lim = await dbLimitMb();
  if (mb >= lim) throw new Error(`Stopped: the database is ${Math.round(mb)} MB, the limit set for the sync is ${lim} MB. Raise it in Data sync if your Supabase plan allows more.`);
}

/** Start over (e.g. after changing the D365 environment). */
export async function resetGl() {
  await ensureGl();
  await sql`truncate gl.lines, gl.orphans, gl.headers, gl.dimsets, gl.sync_state`;
  await sql`refresh materialized view gl.mbal`;
}
