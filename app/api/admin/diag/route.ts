import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { documentTypes, documentRows, journalSummary, userActivity, enteredCounts } from "@/lib/reports/ops";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Admin diagnostics: time each transaction-tracking query (with a statement timeout) and list running database queries. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const company = new URL(req.url).searchParams.get("company") || "usmf";
  const activity = await sql`select pid, state, wait_event_type, wait_event, now() - query_start as running, left(query, 160) query
    from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid() order by query_start`;
  const steps: Record<string, string> = {};
  const time = async (name: string, f: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await Promise.race([f(), new Promise((_, rej) => setTimeout(() => rej(new Error("over 12 s")), 20000))]);
      steps[name] = `${Date.now() - t} ms`;
    } catch (e) { steps[name] = `error after ${Date.now() - t} ms: ${e instanceof Error ? e.message : e}`; }
  };
  await time("journalSummary", () => journalSummary(company));
  await time("documentTypes", () => documentTypes(company));
  await time("documentRows so", () => documentRows(company, "so", "2026-11-10"));
  await time("documentRows po", () => documentRows(company, "po", "2026-11-10"));
  await time("userActivity", () => userActivity(company, "2000-01-01", "2026-11-10"));
  const types = await documentTypes(company);
  await time("all rows sequential", async () => { for (const t of types) await documentRows(company, t.key, "2026-11-10"); });
  for (const t of types) await time(`rows ${t.key}`, () => documentRows(company, t.key, "2026-11-10"));
  await time("all rows parallel", () => Promise.all(types.map((t) => documentRows(company, t.key, "2026-11-10"))));
  await time("enteredCounts", () => enteredCounts(company, "2026-08-01", "2026-11-10"));
  return NextResponse.json({ steps, activity });
}
