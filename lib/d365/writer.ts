import { sql } from "../db";
import { EntityDef, convert } from "./entities";

/**
 * Replace a company's rows for one entity: delete the rows covered by this load, then insert the new ones.
 * mode "full"   -> every row of the company
 * mode "window" -> rows with date >= fromDate (incremental sync)
 */
export async function replaceRows(def: EntityDef, company: string, records: Record<string, unknown>[], fromDate?: string) {
  const fields = Object.entries(def.map);
  const cols = fields.map(([, m]) => m[0]);
  let rows = records.map((r) => {
    const row: Record<string, any> = {};
    for (const [field, [col, type, en]] of fields) row[col] = convert(r[field], type, en);
    if (!def.global) row.company = company;
    Object.assign(row, def.fixed);
    return row;
  });
  const fixedCols = Object.keys(def.fixed ?? {});
  const allCols = def.global ? cols : ["company", ...fixedCols, ...cols];
  // Entities sharing a table only replace their own rows (tagged by the fixed "source" column).
  const own = def.fixed?.source;
  if (def.global) {
    // A global entity read across companies can repeat the same record (e.g. one worker per legal entity): keep one per key.
    const seen = new Set<unknown>();
    rows = rows.filter((r) => r[cols[0]] != null && !seen.has(r[cols[0]]) && (seen.add(r[cols[0]]), true));
  }

  await sql.begin(async (tx) => {
    if (def.global) {
      // Global entity (no company column): replace by key, which is the first mapped column.
      const key = cols[0];
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await tx`delete from ${tx(def.table)} where ${tx(key)} in ${tx(chunk.map((r) => r[key] as string))}`;
        await tx`insert into ${tx(def.table)} ${tx(chunk, allCols)}`;
      }
      return;
    }
    if (def.mode === "window" && fromDate) {
      const dateCol = def.map[def.dateField!][0];
      await tx`delete from ${tx(def.table)} where company = ${company} and ${tx(dateCol)} >= ${fromDate}`;
    } else if (own) {
      await tx`delete from ${tx(def.table)} where company = ${company} and source = ${own}`;
    } else {
      await tx`delete from ${tx(def.table)} where company = ${company}`;
    }
    for (let i = 0; i < rows.length; i += 500) {
      await tx`insert into ${tx(def.table)} ${tx(rows.slice(i, i + 500), allCols)}`;
    }
  });
  return rows.length;
}
