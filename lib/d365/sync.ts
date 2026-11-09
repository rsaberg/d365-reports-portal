import { sql } from "../db";
import { ENTITIES } from "./entities";
import { readAll, readCompanies } from "./odata";
import { d365Config, getSetting } from "./config";
import { mappedEntity } from "./integration";
import { replaceRows } from "./writer";

/**
 * Pull every entity for the given companies from D365 OData into the database.
 * Each entity is read from the data entity mapped in Administration › D365 integration (default: the standard entity).
 * Windowed entities (invoices) reload from `windowFrom` (default: 1 Jan of last year) so history is not re-read each run.
 */
export async function runSync(opts: { companies?: string[]; windowFrom?: string; full?: boolean } = {}) {
  const c = await d365Config();
  if (!c) throw new Error("The D365 connection is not set up. Open Administration › D365 integration.");
  const map = await getSetting<Record<string, string>>("d365_map");
  const all = await readCompanies(mappedEntity(map, "LegalEntities"));
  for (const co of all) {
    await sql`insert into d365.companies ${sql(co)} on conflict (company) do update set name = excluded.name, currency = excluded.currency`;
  }
  const fallback = (process.env.SYNC_COMPANIES || c.company || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const companies = opts.companies?.length ? opts.companies : fallback;
  if (!companies.length) throw new Error("No companies to sync. Set the company in D365 integration, or pick companies.");
  const windowFrom = opts.full ? undefined : opts.windowFrom ?? `${new Date().getFullYear() - 1}-01-01`;
  const results: { company: string; entity: string; rows: number; error?: string }[] = [];

  const globalsDone = new Set<string>();
  for (const company of companies) {
    for (const def of ENTITIES) {
      if (def.global && globalsDone.has(def.entitySet)) continue;
      const entitySet = mappedEntity(map, def.entitySet);
      const [run] = await sql<{ id: number }[]>`insert into d365.sync_runs (source, company, entity) values ('odata', ${company}, ${entitySet}) returning id`;
      try {
        const filters = [def.filter, def.mode === "window" && windowFrom ? `${def.dateField} ge ${windowFrom}T00:00:00Z` : undefined].filter(Boolean).join(" and ");
        const records = await readAll(entitySet, { company, select: Object.keys(def.map), filter: filters || undefined });
        const n = await replaceRows(def, company, records, def.mode === "window" ? windowFrom : undefined);
        await sql`update d365.sync_runs set rows = ${n}, status = 'ok', finished_at = now() where id = ${run.id}`;
        results.push({ company, entity: entitySet, rows: n });
        if (def.global) globalsDone.add(def.entitySet);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sql`update d365.sync_runs set status = 'error', error = ${msg}, finished_at = now() where id = ${run.id}`;
        results.push({ company, entity: entitySet, rows: 0, error: msg });
      }
    }
  }
  return results;
}
