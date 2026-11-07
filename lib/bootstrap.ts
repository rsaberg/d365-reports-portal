import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import bcrypt from "bcryptjs";
import { sql } from "./db";
import { ENTITIES } from "./d365/entities";
import { replaceRows } from "./d365/writer";

const COMPANY_NAMES: Record<string, [string, string]> = {
  usmf: ["Contoso Entertainment System USA", "USD"],
  demf: ["Contoso Entertainment System Germany", "EUR"],
};

export async function migrate() {
  await sql.unsafe(readFileSync(join(process.cwd(), "db/schema.sql"), "utf8"));
}

/** Load snapshot/<company>/<EntitySet>.*.json (exported from D365) using the same mapping as the live sync. */
export async function loadSnapshot(log: (m: string) => void = () => {}) {
  const root = join(process.cwd(), "snapshot");
  if (!existsSync(root)) throw new Error("No snapshot folder in this deployment.");
  const out: Record<string, number> = {};
  for (const company of readdirSync(root)) {
    const dir = join(root, company);
    const [name, currency] = COMPANY_NAMES[company] ?? [company.toUpperCase(), null];
    await sql`insert into d365.companies ${sql({ company, name, currency })} on conflict (company) do update set name = excluded.name, currency = excluded.currency`;
    for (const def of ENTITIES) {
      const files = readdirSync(dir).filter((f) => f.startsWith(def.entitySet + ".")).sort();
      if (!files.length) {
        if (!def.global) await replaceRows(def, company, []);
        continue;
      }
      const records: Record<string, unknown>[] = [];
      for (const f of files) {
        const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as { fields: string[]; rows: unknown[][] };
        for (const r of d.rows) records.push(Object.fromEntries(d.fields.map((k, i) => [k, r[i]])));
      }
      const n = await replaceRows(def, company, records);
      await sql`insert into d365.sync_runs ${sql({ source: "snapshot", company, entity: def.entitySet, rows: n, status: "ok", finished_at: new Date() })}`;
      out[`${company}.${def.entitySet}`] = n;
      log(`${company} ${def.entitySet}: ${n}`);
    }
  }
  return out;
}

export async function ensureAdmin(email: string, name: string, password: string) {
  const [existing] = await sql`select id from portal.users where role = 'admin' limit 1`;
  if (existing) return false;
  await sql`insert into portal.users (email, name, password_hash, role) values (${email}, ${name}, ${await bcrypt.hash(password, 10)}, 'admin')`;
  return true;
}
