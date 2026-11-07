/** Load the D365 snapshot into the database. Usage: npm run load:snapshot */
import "./env";
import { sql } from "../lib/db";
import { loadSnapshot } from "../lib/bootstrap";
loadSnapshot(console.log).then(() => sql.end()).catch((e) => { console.error(e); process.exit(1); });
