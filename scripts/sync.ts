/** Run a D365 sync from the command line. Usage: npm run sync -- [usmf,demf] [--full] */
import "./env";
import { sql } from "../lib/db";
(async () => {
  const { runSync } = await import("../lib/d365/sync");
  const args = process.argv.slice(2);
  const companies = args.find((a) => !a.startsWith("--"))?.split(",");
  const res = await runSync({ companies, full: args.includes("--full") });
  console.table(res);
  await sql.end();
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
