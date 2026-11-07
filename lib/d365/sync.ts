import { sql } from "../db";
import { ENTITIES } from "./entities";
import { readAll, readCompanies, odataConfigured } from "./odata";
import { replaceRows } from "./writer";

/**
 * Pull every entity for the given companies from D365 OData into the database.
 * Windowed entities (invoices) reload from `windowFrom` (default: 1 Jan of last year) so history is not re-read each run.
 */
export async function runSync(opts: { companies?: string[]; windowFrom?: string; full?: boolean } = {}) {
  if (!odataConfigured()) throw new Error("D365 connection is not configured (D365_URL, D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET).");
  const all = await readCompanies();
  for (const c of all) {
    await sql`insert into d365.companies ${sql(c)} on conflict (company) do update set name = excluded.name, currency = excluded.currency`;
  }
  const companies = opts.companies?.length ? opts.companies : (process.env.SYNC_COMPANIES ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!companies.length) throw new Error("No companies to sync. Set SYNC_COMPANIES (e.g. usmf,demf) or pick companies.");
  const windowFrom = opts.full ? undefined : opts.windowFrom ?? `${new Date().getFullYear() - 1}-01-01`;
  const results: { company: string; entity: string; rows: number; error?: string }[] = [];

  const globalsDone = new Set<string>();
  for (const company of companies) {
    for (const def of ENTITIES) {
      if (def.global && globalsDone.has(def.entitySet)) continue;
      const [run] = await sql<{ id: number }[]>`insert into d365.sync_runs (source, company, entity) values ('odata', ${company}, ${def.entitySet}) returning id`;
      try {
        const filters = [def.filter, def.mode === "window" && windowFrom ? `${def.dateField} ge ${windowFrom}T00:00:00Z` : undefined].filter(Boolean).join(" and ");
        const records = await readAll(def.entitySet, { company, select: Object.keys(def.map), filter: filters || undefined });
        const n = await replaceRows(def, company, records, def.mode === "window" ? windowFrom : undefined);
        await sql`update d365.sync_runs set rows = ${n}, status = 'ok', finished_at = now() where id = ${run.id}`;
        results.push({ company, entity: def.entitySet, rows: n });
        if (def.global) globalsDone.add(def.entitySet);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sql`update d365.sync_runs set status = 'error', error = ${msg}, finished_at = now() where id = ${run.id}`;
        results.push({ company, entity: def.entitySet, rows: 0, error: msg });
      }
    }
  }
  return results;
}
