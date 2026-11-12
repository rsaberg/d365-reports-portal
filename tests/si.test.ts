import { test } from "node:test";
import assert from "node:assert/strict";
import { periodContext, fiscal, addYears, tradingDays, trendBuckets, growth, DEFAULT_CALENDAR, CompanyCalendar } from "../lib/si/time";
import { generateDemo, seedReport } from "../lib/si/demo";

const CAL: CompanyCalendar = { fiscalStartMonth: 1, weekStart: 6, weekend: [5], holidays: [] };
const JULY: CompanyCalendar = { ...CAL, fiscalStartMonth: 7 };

test("T03 MTD compares with matched elapsed days of last year, not the whole month", () => {
  const p = periodContext("month", "2026-11-10", CAL, "ly");
  assert.deepEqual(p.current, { start: "2026-11-01", end: "2026-11-10" });
  assert.deepEqual(p.comparison, { start: "2025-11-01", end: "2025-11-10" });
  assert.equal(p.isPartial, true);
});

test("Previous period MTD: same elapsed days of the previous month (31 Mar → Feb end clipped)", () => {
  const p = periodContext("month", "2026-03-31", CAL, "prev");
  assert.deepEqual(p.comparison, { start: "2026-02-01", end: "2026-02-28" });
});

test("Trading-day basis matches elapsed trading days (Fridays off)", () => {
  const p = periodContext("month", "2026-11-10", CAL, "prev", "trading");
  const cur = tradingDays(p.current.start, p.current.end, CAL);
  const prev = tradingDays(p.comparison!.start, p.comparison!.end, CAL);
  assert.equal(cur, prev);
});

test("T04 fiscal year starting July: QTD and YTD boundaries", () => {
  const f = fiscal("2026-11-10", JULY);
  assert.equal(f.fy, 2027); assert.equal(f.fq, 2); assert.equal(f.fyStart, "2026-07-01"); assert.equal(f.fqStart, "2026-10-01");
  const y = periodContext("year", "2026-11-10", JULY, "ly");
  assert.deepEqual(y.current, { start: "2026-07-01", end: "2026-11-10" });
  assert.deepEqual(y.comparison, { start: "2025-07-01", end: "2025-11-10" });
});

test("31 Dec → 1 Jan: calendar year and fiscal year distinction", () => {
  assert.equal(fiscal("2025-12-31", CAL).fy, 2025); assert.equal(fiscal("2026-01-01", CAL).fy, 2026);
  assert.equal(fiscal("2025-12-31", JULY).fy, 2026); assert.equal(fiscal("2026-01-01", JULY).fy, 2026);
});

test("T05 leap day maps to 28 Feb last year", () => {
  assert.equal(addYears("2024-02-29", 1), "2025-02-28");
  const p = periodContext("month", "2024-02-29", CAL, "ly");
  assert.deepEqual(p.comparison, { start: "2023-02-01", end: "2023-02-28" });
});

test("Mid-quarter: QTD vs comparable elapsed prior quarter", () => {
  const p = periodContext("quarter", "2026-11-10", CAL, "prev");
  assert.deepEqual(p.current, { start: "2026-10-01", end: "2026-11-10" });
  assert.deepEqual(p.comparison, { start: "2026-07-01", end: "2026-08-10" });
});

test("Daily compare = same weekday last year; weekly = same week position", () => {
  const d = periodContext("day", "2026-11-10", CAL, "ly");
  assert.equal(new Date(d.comparison!.start).getUTCDay(), new Date("2026-11-10").getUTCDay());
  const w = periodContext("week", "2026-11-10", CAL, "ly");
  assert.equal(w.current.start, "2026-11-07"); // Saturday week start
});

test("Trend buckets per grain", () => {
  assert.equal(trendBuckets("day", "2026-11-10", CAL).ranges.length, 30);
  assert.equal(trendBuckets("week", "2026-11-10", CAL).ranges.length, 13);
  assert.equal(trendBuckets("month", "2026-11-10", CAL).ranges.length, 30);
  assert.equal(trendBuckets("year", "2026-11-10", CAL).ranges.length, 12);
});

test("T19 zero denominators return N/A", () => {
  assert.equal(growth(100, 0), null); assert.equal(growth(100, null), null); assert.equal(growth(-50, -100), 0.5);
});

// ---------------- Demo data integrity ----------------
const demo = generateDemo();

test("T31 demo is deterministic", () => {
  assert.equal(JSON.stringify(seedReport(generateDemo())), JSON.stringify(seedReport(demo)));
});

test("Spec volumes: ≥80 customers, ≥250 SKUs, ≥10 reps, ≥4,000 orders, ≥8,000 invoice lines, 3 years", () => {
  const r = seedReport(demo);
  assert.ok(r.counts.customers >= 80); assert.ok(r.counts.products >= 250); assert.ok(r.counts.salespeople >= 10);
  assert.ok(r.counts.orders >= 4000); assert.ok(r.counts.invoiceLines >= 8000);
  assert.ok(Object.keys(r.byMonth).length >= 36);
});

test("T06/T07 daily totals add up to monthly and yearly totals", () => {
  const byDay = new Map<string, number>();
  for (const l of demo.invoiceLines) byDay.set(l.invoice_date, (byDay.get(l.invoice_date) ?? 0) + l.net_mst);
  const r = seedReport(demo);
  for (const [m, v] of Object.entries(r.byMonth)) {
    const s = [...byDay].filter(([d]) => d.startsWith(m)).reduce((a, [, x]) => a + x, 0);
    assert.ok(Math.abs(s - v) < 0.05, m);
  }
  const yearSum = Object.values(r.byYear).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(yearSum - r.netSalesMst) < 0.05);
});

test("T11 no revenue multiplication: invoiced qty per order line ≤ ordered qty", () => {
  const inv = new Map<string, number>();
  for (const l of demo.invoiceLines) if (l.doc_type === "invoice") inv.set(`${l.order_id}|${l.order_line}`, (inv.get(`${l.order_id}|${l.order_line}`) ?? 0) + l.qty);
  for (const o of demo.orderLines) assert.ok((inv.get(`${o.order_id}|${o.line_no}`) ?? 0) <= o.qty - o.cancelled_qty + 1e-9, o.order_id);
});

test("S02 split deliveries/invoices exist; S04 cancelled lines have no invoices", () => {
  const slipsPerLine = new Map<string, number>();
  for (const s of demo.slipLines) slipsPerLine.set(`${s.order_id}|${s.line_no}`, (slipsPerLine.get(`${s.order_id}|${s.line_no}`) ?? 0) + 1);
  assert.ok([...slipsPerLine.values()].some((n) => n >= 2));
  const cancelled = new Set(demo.orderLines.filter((o) => o.status === "cancelled").map((o) => `${o.order_id}|${o.line_no}`));
  assert.ok(cancelled.size > 0);
  assert.ok(!demo.invoiceLines.some((l) => cancelled.has(`${l.order_id}|${l.order_line}`)));
});

test("T18 price-only credits carry no returned units; returns are negative", () => {
  const credits = demo.invoiceLines.filter((l) => l.doc_type === "credit");
  assert.ok(credits.some((l) => l.credit_class === "commercial_credit"));
  for (const l of credits) {
    assert.ok(l.net < 0);
    if (l.credit_class === "commercial_credit") assert.equal(l.qty, 0); else assert.ok(l.qty < 0);
  }
});

test("T14 VAT kept separate from net", () => {
  for (const l of demo.invoiceLines.slice(0, 500)) assert.ok(Math.abs(l.tax - Math.round(l.net * 0.14 * 100) / 100) <= 0.011);
});

test("S11 multi-currency lines carry FX into accounting currency", () => {
  const usd = demo.invoiceLines.filter((l) => l.currency === "USD");
  assert.ok(usd.length > 0);
  for (const l of usd.slice(0, 50)) assert.ok(Math.abs(l.net_mst - Math.round(l.net * l.fx_rate * 100) / 100) <= 0.011);
});
