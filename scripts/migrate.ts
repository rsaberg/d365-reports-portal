import "./env";
import { readFileSync } from "fs";
import { sql } from "../lib/db";
(async () => {
  await sql.unsafe(readFileSync("db/schema.sql", "utf8"));
  console.log("Schema is up to date.");
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
