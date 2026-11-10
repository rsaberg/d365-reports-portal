import { sql } from "../db";
import { ENTITIES } from "./entities";
import { readAll, readCompanies } from "./odata";
import { d365Config, getSetting } from "./config";
import { mappedEntity } from "./integration";
import { replaceRows } from "./writer";

/**
 * Pull D365 data through the connection in Administration › D365 integration.
 * Each entity is read from the data entity mapped to its function (default: the standard entity).
 * Windowed entities (invoices) reload from `windowFrom` (default: 1 Jan of last year) so history is not re-read each run.
 */

export type SyncResult = { company: string; entity: string; rows: number; error?: string };

/** Companies to sync when none are picked: SYNC_COMPANIES, else the company set on the integration page. */
export async function defaultCompanies() {
  const c = await d365Config();
  return (process.env.SYNC_COMPANIES || c?.company || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** Refresh the legal entities list from D365. */
export async function syncCompanyList() {
  if (!(await d365Config())) throw new Error("The D365 connection is not set up. Open Administration › D365 integration.");
  const map = await getSetting<Record<string, string>>("d365_map");
  const all = await readCompanies(mappedEntity(map, "LegalEntities"));
  for (const co of all) {
    await sql`insert into d365.companies ${sql(co)} on conflict (company) do update set name = excluded.name, currency = excluded.currency`;
  }
  return all;
}

/** Companies whose data came from the bundled demo snapshot and was never synced live. */
export async function snapshotCompanies() {
  const rows = await sql<{ company: string }[]>`
    select distinct company from d365.sync_runs where source = 'snapshot' and company is not null
    except select distinct company from d365.sync_runs where source = 'odata' and status = 'ok' and company is not null`;
  return rows.map((r) => r.company);
}

/** Remove the demo snapshot data (every portal table) for the given companies. */
export async function dropCompanies(companies: string[]) {
  if (!companies.length) return;
  await sql.begin(async (tx) => {
    for (const def of ENTITIES) {
      if (def.global) await tx`delete from ${tx(def.table)}`;
      else await tx`delete from ${tx(def.table)} where company in ${tx(companies)}`;
    }
    await tx`delete from d365.sync_runs where company in ${tx(companies)}`;
    await tx`delete from portal.user_companies where company in ${tx(companies)}`;
    await tx`delete from portal.targets where company in ${tx(companies)}`;
    await tx`delete from d365.companies where company in ${tx(companies)}`;
  });
}

/** Remove every company's synced data (all d365 tables, runs, user companies, targets) — used when switching environment. */
export async function dropAllCompanies() {
  const rows = await sql<{ company: string }[]>`
    select company from d365.companies union select distinct company from d365.sync_runs where company is not null`;
  await dropCompanies(rows.map((r) => r.company));
  await sql`delete from d365.sync_runs`;
}

/** Sync one entity (by its default entity set name) for one company. */
export async function syncEntity(company: string, defaultEntity: string, opts: { windowFrom?: string; full?: boolean; period?: { from: string; to: string } } = {}): Promise<SyncResult> {
  const def = ENTITIES.find((d) => d.entitySet === defaultEntity);
  if (!def) throw new Error("Unknown entity " + defaultEntity);
  const map = await getSetting<Record<string, string>>("d365_map");
  const entitySet = mappedEntity(map, def.entitySet);
  const windowFrom = opts.full ? undefined : opts.windowFrom ?? `${new Date().getFullYear() - 1}-01-01`;
  const [run] = await sql<{ id: number }[]>`insert into d365.sync_runs (source, company, entity) values ('odata', ${company}, ${entitySet}) returning id`;
  try {
    // A period load (e.g. two months) reads only that range of transactional entities and replaces the company's rows; master data loads in full.
    const p = opts.period;
    const dateFilter = p && def.periodField ? `${def.periodField} ge ${p.from}T00:00:00Z and ${def.periodField} le ${p.to}T23:59:59Z`
      : !p && def.mode === "window" && windowFrom ? `${def.dateField} ge ${windowFrom}T00:00:00Z` : undefined;
    const filters = [def.filter, dateFilter].filter(Boolean).join(" and ");
    const records = await readAll(entitySet, { company: def.global ? null : company, select: Object.keys(def.map), filter: filters || undefined });
    const n = await replaceRows(def, company, records, !p && def.mode === "window" ? windowFrom : undefined);
    await sql`update d365.sync_runs set rows = ${n}, status = 'ok', finished_at = now() where id = ${run.id}`;
    return { company, entity: entitySet, rows: n };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`update d365.sync_runs set status = 'error', error = ${msg}, finished_at = now() where id = ${run.id}`;
    return { company, entity: entitySet, rows: 0, error: msg };
  }
}

/** Full run in one call (daily cron and the CLI script). */
export async function runSync(opts: { companies?: string[]; windowFrom?: string; full?: boolean; period?: { from: string; to: string } } = {}) {
  await syncCompanyList();
  const companies = opts.companies?.length ? opts.companies : await defaultCompanies();
  if (!companies.length) throw new Error("No companies to sync. Set the company in D365 integration, or pick companies.");
  const results: SyncResult[] = [];
  const globalsDone = new Set<string>();
  for (const company of companies) {
    for (const def of ENTITIES) {
      if (def.global && globalsDone.has(def.entitySet)) continue;
      const r = await syncEntity(company, def.entitySet, opts);
      results.push(r);
      if (def.global && !r.error) globalsDone.add(def.entitySet);
    }
  }
  return results;
}
