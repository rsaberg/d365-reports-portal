/**
 * Sales Intelligence integration tests against a real Postgres (DATABASE_URL). Run:
 *   node --conditions=react-server --import tsx --test tests/si.db.test.ts
 * They load the DEMO companies, run every KPI, the reconciliation controls and the D365 projection.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../lib/db";
import { ensureSi, loadDemo, projectFromD365 } from "../lib/si/store";
import { computeKpis } from "../lib/si/metrics";
import { invAgg, arAsOf, backlogAsOf, pvm, dailySeries, bucketSum } from "../lib/si/query";
import { periodContext, DEFAULT_CALENDAR, trendBuckets } from "../lib/si/time";
import { CATALOG } from "../lib/si/catalog";
import { generateDemo, seedReport, DEMO_AS_OF } from "../lib/si/demo";
import { reconScreen } from "../lib/si/screens";
import type { SiScope } from "../lib/si/scope";

const CAL = { ...DEFAULT_CALENDAR };
function scope(company: string, grain: "day" | "week" | "month" | "quarter" | "year", dims: SiScope["f"]["dims"] = {}, role: "admin" | "sales" = "admin", asOf = DEMO_AS_OF): SiScope {
  const user = { id: 1, email: "t@t", name: "t", role, personnel_number: role === "sales" ? "SR003" : null, companies: [] } as SiScope["user"];
  const co = { company, name: company, currency: "EGP", mode: "DEMO" as const, data_as_of: asOf, fiscal_start_month: 1, week_start: 6, weekend: [5], timezone: "Africa/Cairo" };
  const pinned = role === "sales" ? "SR003" : null;
  return { user, companies: [co], co, cal: CAL, asOf, grain, compare: "ly", basis: "calendar", pc: periodContext(grain, asOf, CAL, "ly"), f: { company, dims: pinned ? { ...dims, salesperson: [pinned] } : dims }, q: {}, pinnedRep: pinned };
}

before(async () => { await ensureSi(); await loadDemo(); });
after(async () => { await sql.end(); });

test("DEMO load matches the generator exactly (T31 + source→model)", async () => {
  const r = seedReport(generateDemo());
  const [a] = await sql<{ n: number; net: number }[]>`select count(*)::int n, sum(net_mst) net from si.invoice_line where company = 'dat'`;
  assert.equal(a.n, r.counts.invoiceLines + r.counts.creditLines);
  assert.ok(Math.abs(a.net - r.netSalesMst) < 0.05, `${a.net} vs ${r.netSalesMst}`);
});

test("Company isolation: dat2 is empty and never sees dat rows (T27)", async () => {
  const i = await invAgg({ company: "dat2", dims: {} }, { start: "2000-01-01", end: "2100-01-01" });
  assert.equal(i.lines, 0); assert.equal(i.net, 0);
  const k = await computeKpis(scope("dat2", "month"));
  assert.equal(k.get("REV-004")!.v, 0);
  assert.equal(k.get("REV-005")!.v, null); // zero base → N/A, never 0% or ∞
});

test("Every IMPLEMENTED KPI is computed by the engine", async () => {
  const k = await computeKpis(scope("dat", "month"));
  const missing = CATALOG.filter((c) => c.status === "IMPLEMENTED" && !k.has(c.id)).map((c) => c.id);
  assert.deepEqual(missing, []);
  const extra = [...k.keys()].filter((id) => CATALOG.find((c) => c.id === id)?.status === "NOT BUILT");
  assert.deepEqual(extra, []);
});

test("Daily buckets sum to the monthly KPI; trend buckets reproduce MTD (T06/T07)", async () => {
  const s = scope("dat", "month");
  const k = await computeKpis(s);
  const tb = trendBuckets("month", s.asOf, CAL);
  const ser = await dailySeries(s.f, { start: tb.ranges[0].start, end: s.asOf });
  const sum = tb.ranges.filter((r) => r.start <= s.asOf).reduce((a, r) => a + bucketSum(ser, r).net, 0);
  assert.ok(Math.abs(sum - (k.get("REV-004")!.v as number)) < 0.01);
  assert.ok(Math.abs((k.get("REV-009")!.v as number) - (k.get("REV-004")!.v as number)) < 0.01);
});

test("Quarter and year KPIs equal the sum of their atomic days", async () => {
  for (const g of ["quarter", "year"] as const) {
    const s = scope("dat", g);
    const inv = await invAgg(s.f, s.pc.current);
    const ser = await dailySeries(s.f, s.pc.current);
    assert.ok(Math.abs(inv.net - bucketSum(ser, s.pc.current).net) < 0.01, g);
  }
});

test("Snapshots are as-of, not summed: backlog/AR on a past date differ from today and AR = Σ transactions", async () => {
  const f = { company: "dat", dims: {} };
  const a1 = await arAsOf(f, "2026-06-30"), a2 = await arAsOf(f, DEMO_AS_OF);
  const [t] = await sql<{ v: number }[]>`select sum(amount) v from si.ar_trans where company = 'dat' and trans_date <= '2026-06-30'`;
  assert.ok(Math.abs(a1.open - t.v) < 0.05);
  assert.notEqual(Math.round(a1.open), Math.round(a2.open));
  const b = await backlogAsOf(f, DEMO_AS_OF);
  assert.ok(b.value > 0 && b.lines > 0);
});

test("PVM bridge reconciles exactly to the total change (spec §10.3)", async () => {
  const s = scope("dat", "year");
  const b = await pvm(s.f, s.pc.current, s.pc.comparison!);
  assert.ok(Math.abs(b.residual) < 0.01, `residual ${b.residual}`);
  const inv = await invAgg(s.f, s.pc.current);
  assert.ok(Math.abs(b.current - inv.net) < 0.01);
});

test("Sales role is pinned to its own salesperson (RLS)", async () => {
  const all = await computeKpis(scope("dat", "year"));
  const mine = await computeKpis(scope("dat", "year", {}, "sales"));
  const [r] = await sql<{ v: number }[]>`select sum(net_mst) v from si.invoice_line where company = 'dat' and salesperson = 'SR003' and invoice_date between '2026-01-01' and ${DEMO_AS_OF}`;
  assert.ok(Math.abs((mine.get("REV-004")!.v as number) - r.v) < 0.01);
  assert.ok((mine.get("REV-004")!.v as number) < (all.get("REV-004")!.v as number));
});

test("Approved target version only (S30): August 2026 uses version 2", async () => {
  const [v] = await sql<{ n: number }[]>`select count(*)::int n from si.target where company = 'dat' and month = '2026-08-01' and status = 'approved' and version = 1`;
  assert.equal(v.n, 0);
  const k = await computeKpis({ ...scope("dat", "month", {}, "admin", "2026-08-31") });
  const [t] = await sql<{ v: number }[]>`select sum(amount) v from si.target where company = 'dat' and month = '2026-08-01' and status = 'approved'`;
  assert.ok(Math.abs((k.get("TAR-001")!.v as number) - t.v) < 1);
});

test("Reconciliation controls all pass on the demo company", async () => {
  const sc = await reconScreen(scope("dat", "month"));
  const table = sc.blocks.find((b) => b.t === "table") as any;
  const fails = table.rows.filter((r: any) => r.status !== "PASS");
  assert.deepEqual(fails, []);
});

test("CONNECTED projection of a synced D365 company reconciles to the source", async () => {
  const [co] = await sql<{ company: string; currency: string }[]>`select company, currency from d365.companies where company = 'usmf'`;
  if (!co) return; // snapshot not loaded in this environment
  const counts = await projectFromD365("usmf", null);
  assert.ok(counts.invoice_line > 0);
  const [src] = await sql<{ v: number }[]>`select coalesce(sum(line_amount),0) v from d365.invoice_lines where company = 'usmf' and currency = ${co.currency}`;
  const [mod] = await sql<{ v: number }[]>`select coalesce(sum(net_mst),0) v from si.invoice_line where company = 'usmf'`;
  assert.ok(Math.abs(src.v - mod.v) < 0.05);
  const [m] = await sql<{ mode: string; data_as_of: string }[]>`select mode, data_as_of from si.company where company = 'usmf'`;
  const k = await computeKpis({ ...scope("usmf", "year", {}, "admin", m.data_as_of), co: { ...scope("usmf", "year").co, mode: "CONNECTED_D365", currency: co.currency, data_as_of: m.data_as_of } });
  assert.equal(k.get("MAR-002")!.v, null); // no posted cost in the entity → BLOCKED, never estimated
  assert.ok((k.get("REV-004")!.v as number) !== 0);
});
