import "server-only";
import { sql } from "../db";
import type { Block, Screen } from "@/components/si/View";
import type { Col } from "@/components/DataTable";
import type { KpiValue } from "./metrics";
import { addDays, addYears, fiscal, growth, periodContext, periodOf, safeDiv, tradingDays, trendBuckets, weekStartOf, isTradingDay, type Range } from "./time";
import { arAsOf, backlogAsOf, bucketSum, dailySeries, delAgg, ilWhere, arWhere, olWhere, invBy, invLines, netByMonth, pvm, targetFor, settledAsOf, type SiFilter } from "./query";
import { siHref, type SiScope } from "./scope";
import { CATALOG, REPORTS } from "./catalog";

type K = Map<string, KpiValue>;
const r0 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const withDim = (f: SiFilter, d: keyof SiFilter["dims"], v: string): SiFilter => ({ company: f.company, dims: { ...f.dims, [d]: [v] } });
/** A drill link keeps the context; `{field}` placeholders are filled per row by DataTable. */
const tpl = (s: SiScope, path: string, over: Record<string, string> = {}) => {
  const base = siHref(s, path, Object.fromEntries(Object.keys(over).map((k) => [k, null])));
  return base + (base.includes("?") ? "&" : "?") + Object.entries(over).map(([k, v]) => `${k}=${v}`).join("&");
};

// ------------------------------------------------------------------ shared blocks
/** Trend for the selected grain: current buckets vs comparable buckets, with cumulative actual vs cumulative target. */
async function trendBlock(s: SiScope, title?: string): Promise<Block> {
  const { f, cal, asOf, grain, compare } = s;
  const tb = trendBuckets(grain, asOf, cal);
  const shift = (r: Range): Range => {
    if (compare === "none") return r;
    if (compare === "ly") return tb.bucket === "month" ? { start: addYears(r.start, -1), end: addDays(addYears(addDays(r.end, 1), -1), -1) } : { start: addDays(r.start, -364), end: addDays(r.end, -364) };
    // previous period: shift the whole window back by one selected period
    const p = periodContext(grain, asOf, cal, "prev");
    const off = Math.round((Date.parse(p.comparisonFull!.start) - Date.parse(p.full.start)) / 86400000);
    return tb.bucket === "month" ? { start: addYears(r.start, -1), end: addDays(addYears(addDays(r.end, 1), -1), -1) } : { start: addDays(r.start, off), end: addDays(r.end, off) };
  };
  const first = tb.ranges[0].start, last = tb.ranges[tb.ranges.length - 1].end;
  const series = await dailySeries(f, { start: shift({ start: first, end: first }).start < first ? shift({ start: first, end: first }).start : first, end: last });
  const cumulative = grain === "month" || grain === "quarter" || grain === "year";
  const tdFn = (a: string, b: string) => tradingDays(a, b, cal);
  let cumC = 0, cumT = 0;
  const data = [];
  for (const r of tb.ranges) {
    const future = r.start > asOf;
    const end = r.end > asOf ? asOf : r.end;
    const c = future ? null : bucketSum(series, { start: r.start, end }).net;
    const pr = compare === "none" ? null : bucketSum(series, shift(r)).net;
    let t: number | null = null;
    if (cumulative) { t = (await targetFor(f, r, tdFn)).amount; cumT += t ?? 0; if (c !== null) cumC += c; }
    const drill = tb.bucket === "day" ? siHref(s, "/si/daily", { asOf: r.start, g: "day" }) : tb.bucket === "week" ? siHref(s, "/si/weekly", { asOf: end < r.start ? r.start : end, g: "week" }) : siHref(s, "/si/monthly", { asOf: r.end > asOf ? asOf : r.end, g: "month" });
    data.push({ label: r.label, tip: `${r.start} → ${r.end}`, cur: r0(c), prev: r0(pr), cumCur: future ? null : r0(cumC), cumTarget: cumulative && t !== null ? r0(cumT) : null, href: future ? undefined : drill, future });
  }
  const bucketWord = tb.bucket === "day" ? "Daily" : tb.bucket === "week" ? "Weekly" : "Monthly";
  return { t: "trend", wide: true, title: title ?? `${bucketWord} net sales${cumulative ? " · cumulative vs target" : ""}`, sub: `${s.co.currency} · click a bar to drill down`, data,
    curName: "Net sales", prevName: compare === "none" ? undefined : compare === "ly" ? "Same period last year" : "Previous period", cumulative };
}

async function heatBlock(s: SiScope, weeks = 6): Promise<Block> {
  const { f, cal, asOf } = s;
  const end = addDays(weekStartOf(asOf, cal), 6);
  const start = addDays(end, -7 * weeks + 1);
  const series = await dailySeries(f, { start, end });
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(start, 7 * w);
    rows.push({ label: `${Number(ws.slice(8))} ${MON[Number(ws.slice(5, 7)) - 1]}`, cells: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i);
      return { date: d, v: d > asOf ? null : r0(series.get(d)?.net ?? 0), off: !isTradingDay(d, cal), href: d > asOf ? undefined : siHref(s, "/si/daily", { asOf: d, g: "day" }) };
    }) });
  }
  return { t: "heat", title: "Daily sales heat map", sub: "Hatched = non-trading day · click a day", weeks: rows, days: Array.from({ length: 7 }, (_, i) => WD[(cal.weekStart + i) % 7]) };
}

async function pvmBlock(s: SiScope): Promise<Block | null> {
  if (!s.pc.comparison) return null;
  const b = await pvm(s.f, s.pc.current, s.pc.comparison);
  const steps = [
    { label: s.pc.comparisonLabel ?? "Base", value: b.base, total: true }, { label: "Volume", value: b.volume }, { label: "Mix", value: b.mix }, { label: "Price", value: b.price },
    { label: "New SKUs", value: b.newItems }, { label: "Lost SKUs", value: b.lost }, { label: "Allowances", value: b.credits },
    ...(Math.abs(b.other) > 0.5 ? [{ label: "Other", value: b.other }] : []), { label: s.pc.label, value: b.current, total: true },
  ];
  return { t: "waterfall", title: "Revenue bridge: price · volume · mix", sub: `Reconciles exactly · residual ${b.residual.toFixed(2)}`, steps: steps.map((x) => ({ ...x, href: siHref(s, "/si/pvm") })) };
}

function funnelBlock(s: SiScope, k: K): Block {
  const v = (id: string) => (typeof k.get(id)?.v === "number" ? (k.get(id)!.v as number) : 0);
  return { t: "funnel", title: "Order-to-cash layers in the period", sub: "Each layer uses its own event date", steps: [
    { label: "Ordered (order intake)", value: v("ORD-002"), note: "Order lines created in the period", href: siHref(s, "/si/orders") },
    { label: "Delivered (packing slips)", value: v("FUL-002"), note: "Slip lines posted in the period", href: siHref(s, "/si/fulfilment") },
    { label: "Invoiced (net sales)", value: v("REV-004"), note: "Invoice and credit lines posted in the period", href: siHref(s, "/si/invoices") },
    { label: "Collected (cash received)", value: v("AR-008"), note: "Customer payments in the period (incl. VAT)", href: siHref(s, "/si/ar") },
  ] };
}

async function rankBlock(s: SiScope, dim: "customer" | "item" | "territory" | "salesperson" | "channel" | "category" | "brand" | "warehouse", title: string, n = 10, wide = false): Promise<Block> {
  const rows = await invBy(s.f, dim, s.pc.current, s.pc.comparison, n);
  const path = dim === "customer" ? "/si/customer" : null;
  return { t: "rank", title, wide, sub: `${s.co.currency} net · marker = comparison`, rows: rows.map((r) => ({
    label: r.label, value: r.cur, prev: s.pc.comparison ? r.prev : null, sub: `${r.key} · growth ${fmtPct(growth(r.cur, r.prev))}`,
    href: path ? siHref(s, path, { c: r.key }) : siHref(s, "/si", { [dim]: r.key }),
  })) };
}
const fmtPct = (x: number | null) => (x === null ? "N/A" : `${(x * 100).toFixed(1)}%`);

const LINE_COLS = (s: SiScope): Col[] => [
  { key: "invoice_date", label: "Date", type: "date" }, { key: "invoice_id", label: "Document" }, { key: "doc_type", label: "Type" },
  { key: "customer_name", label: "Customer", href: tpl(s, "/si/customer", { c: "{customer}" }) }, { key: "item_name", label: "Item" }, { key: "qty", label: "Qty", type: "num" },
  { key: "gross_mst", label: "Gross", type: "money" }, { key: "discount_mst", label: "Discount", type: "money" }, { key: "net_mst", label: "Net", type: "money" },
  { key: "tax_mst", label: "VAT (separate)", type: "money" }, { key: "cogs_mst", label: "COGS", type: "money" }, { key: "gp", label: "Gross profit", type: "money", tone: "signed" },
  { key: "gm", label: "GM %", type: "pct" }, { key: "currency", label: "Doc cur." }, { key: "salesperson", label: "Rep" }, { key: "order_id", label: "Sales order" }, { key: "source_key", label: "Source record" },
];
async function linesBlock(s: SiScope, title: string, r: Range = s.pc.current, limit = 200): Promise<Block> {
  const rows = await invLines(s.f, r, { limit });
  return { t: "table", title, sub: `Latest ${rows.length} lines · full list in Invoices & credits`, cols: LINE_COLS(s), rows, maxHeight: 420 };
}

// ------------------------------------------------------------------ 01–06 executive and time dashboards
export async function timeDashboard(s: SiScope, k: K, view: "exec" | "day" | "week" | "month" | "quarter" | "year"): Promise<Screen> {
  const g = s.grain;
  const blocks: Block[] = [];
  const titles = { exec: "Executive Sales Command Center", day: "Daily Sales Command Center", week: "Weekly Trading Pulse", month: "Monthly Business Review", quarter: "Quarterly Strategic Review", year: "Annual & Multi-Year Performance" };
  if (view === "exec") {
    blocks.push({ t: "kpis", ids: ["REV-004", "REV-005", "MAR-002", "MAR-003", "TAR-002", "TAR-005", "ORD-002", "ORD-005", "FUL-004", "RET-003", "AR-008", "AR-001"] });
  } else if (view === "day") {
    blocks.push({ t: "kpis", title: "Sales", ids: ["REV-001", "REV-003", "REV-004", "MAR-002", "MAR-003", "PRI-004", "ORD-001", "ORD-002", "FUL-002", "AR-008", "ORD-012", "RET-003"] });
    blocks.push({ t: "kpis", title: "Activity, backlog and risk", ids: ["CUS-001", "CUS-002", "TEA-005", "PRD-001", "PRD-002", "ORD-015", "ORD-005", "FUL-011", "FUL-004", "AR-002", "TAR-005", "REV-009"] });
    blocks.push({ t: "note", text: "Hourly sales are not shown: invoice lines carry a business date only, so an hour-of-day split would be invented. Data refresh is batch (not real-time); see Connection health for the last load." });
  } else if (view === "week") {
    blocks.push({ t: "kpis", ids: ["REV-004", "REV-013", "ORD-002", "FUL-004", "MAR-003", "CUS-001", "RET-003", "TAR-005", "AR-008", "ORD-005", "FUL-003", "PRD-001"] });
  } else if (view === "month") {
    blocks.push({ t: "kpis", ids: ["REV-009", "REV-006", "REV-005", "TAR-001", "TAR-002", "TAR-007", "MAR-003", "RET-003", "ORD-002", "FUL-003", "AR-001", "AR-010"] });
  } else if (view === "quarter") {
    blocks.push({ t: "kpis", ids: ["REV-010", "REV-007", "REV-005", "TAR-002", "MAR-002", "MAR-003", "ORD-005", "CUS-002", "AR-001", "PRD-009", "TEA-012", "REV-014"] });
  } else {
    blocks.push({ t: "kpis", ids: ["REV-008", "REV-005", "TAR-002", "MAR-002", "MAR-003", "ORD-001", "CUS-001", "RET-003", "AR-008", "ORD-005", "REV-012", "TAR-011"] });
  }
  blocks.push(await trendBlock(s));
  if (view === "day") {
    const v = (id: string) => (k.get(id)?.v as number) ?? 0;
    blocks.push({ t: "waterfall", title: "Gross → discount → credits → net", sub: "Selected day", steps: [
      { label: "Gross", value: v("REV-001"), total: true }, { label: "Discounts", value: -v("REV-002") }, { label: "Returns", value: -v("RET-001") }, { label: "Allowances", value: -v("RET-002") }, { label: "Net", value: v("REV-004"), total: true }] });
    blocks.push(await heatBlock(s));
    blocks.push(await rankBlock(s, "customer", "Top customers"), await rankBlock(s, "item", "Top SKUs"));
    blocks.push(await rankBlock(s, "salesperson", "Sales rep activity"), await rankBlock(s, "territory", "Territories vs comparison"));
    blocks.push(await linesBlock(s, "Invoice ledger for the day"));
    return { title: titles.day, layer: "INVOICED", blocks, showGrain: true };
  }
  const pv = await pvmBlock(s);
  if (view === "exec") {
    if (pv) blocks.push(pv);
    blocks.push(funnelBlock(s, k));
    blocks.push(await rankBlock(s, "territory", "Sales by territory"), await rankBlock(s, "category", "Sales by category"));
    const cust = await invBy(s.f, "customer", s.pc.current, null, 60);
    blocks.push({ t: "pareto", title: "Customer Pareto", sub: "Top 60 customers · line = cumulative share", rows: cust.map((c) => ({ label: c.label, value: c.cur, href: siHref(s, "/si/customer", { c: c.key }) })) });
    blocks.push(await rankBlock(s, "customer", "Top customers"));
    blocks.push(await linesBlock(s, "Latest invoice and credit lines", s.pc.current, 100));
    return { title: titles.exec, layer: "INVOICED · ORDERED · DELIVERED · COLLECTED", blocks };
  }
  if (view === "week") {
    const series = await dailySeries(s.f, { start: addDays(s.asOf, -90), end: s.asOf });
    const byWd = new Map<number, { v: number; n: number }>();
    for (const [d, x] of series) { const w = new Date(d + "T00:00:00Z").getUTCDay(); const t = byWd.get(w) ?? { v: 0, n: 0 }; t.v += x.net; t.n++; byWd.set(w, t); }
    blocks.push({ t: "rank", title: "Average sales by weekday", sub: "Last 90 days, trading days with sales", rows: Array.from({ length: 7 }, (_, i) => (s.cal.weekStart + i) % 7).map((w) => ({ label: WD[w], value: byWd.get(w) ? byWd.get(w)!.v / byWd.get(w)!.n : 0 })) });
    blocks.push(await heatBlock(s, 8));
    blocks.push(await moversBlock(s, "customer", "Top movers · customers"), await moversBlock(s, "item", "Top movers · SKUs"));
    return { title: titles.week, layer: "INVOICED", blocks, showGrain: true };
  }
  if (pv) blocks.push(pv);
  if (view === "month") {
    blocks.push(await heatBlock(s, 6));
    blocks.push(await moversBlock(s, "customer", "Customer movers"), await moversBlock(s, "item", "SKU movers"));
    blocks.push(await rankBlock(s, "territory", "Territory performance"));
    const ar = await arAsOf(s.f, s.pc.current.end);
    blocks.push({ t: "funnel", title: "Month-end receivables (as of)", sub: s.pc.current.end, steps: [
      { label: "Not yet due", value: ar.current, note: "AR-003" }, { label: "1–30 days late", value: ar.aging[0], note: "AR-004" }, { label: "31–60 days late", value: ar.aging[1], note: "AR-005" },
      { label: "61–90 days late", value: ar.aging[2], note: "AR-006" }, { label: "Over 90 days late", value: ar.aging[3], note: "AR-007", href: siHref(s, "/si/ar") }] });
    blocks.push(await linesBlock(s, "Invoice lines this month", s.pc.current, 200));
    return { title: titles.month, layer: "INVOICED", blocks, showGrain: true };
  }
  if (view === "quarter") {
    const months: Block = { t: "table", title: "The quarter month by month", cols: [{ key: "m", label: "Month" }, { key: "cur", label: "Net sales", type: "money" }, { key: "prev", label: "Same month LY", type: "money" }, { key: "g", label: "YoY", type: "pct" }, { key: "gp", label: "Gross profit", type: "money" }, { key: "gm", label: "GM %", type: "pct" }, { key: "tgt", label: "Target", type: "money" }, { key: "att", label: "Attainment", type: "pct" }], rows: [] };
    const all = await netByMonth(s.f);
    const byM = new Map(all.map((m) => [m.m, m]));
    for (let i = 0; i < 3; i++) {
      const ms = s.pc.full.start; const m0 = new Date(Date.UTC(+ms.slice(0, 4), +ms.slice(5, 7) - 1 + i, 1)).toISOString().slice(0, 7);
      const ly = `${+m0.slice(0, 4) - 1}${m0.slice(4)}`;
      const me = new Date(Date.UTC(+m0.slice(0, 4), +m0.slice(5, 7), 0)).toISOString().slice(0, 10);
      const t = (await targetFor(s.f, { start: m0 + "-01", end: me }, (a, b) => tradingDays(a, b, s.cal))).amount;
      const c = byM.get(m0)?.net ?? 0;
      (months as any).rows.push({ m: `${MON[+m0.slice(5, 7) - 1]} ${m0.slice(0, 4)}${me > s.asOf ? " (to date)" : ""}`, cur: c, prev: byM.get(ly)?.net ?? 0, g: growth(c, byM.get(ly)?.net ?? null), gp: byM.get(m0)?.gp ?? null, gm: byM.get(m0)?.gp != null ? safeDiv(byM.get(m0)!.gp!, c) : null, tgt: t, att: t ? c / t : null });
    }
    blocks.push(months);
    blocks.push(await rankBlock(s, "category", "Category shift"), await rankBlock(s, "channel", "Channel shift"));
    blocks.push(await moversBlock(s, "customer", "Customers gained and lost"));
    return { title: titles.quarter, layer: "INVOICED", blocks, showGrain: true };
  }
  // year
  const all = await netByMonth(s.f);
  const fyT = new Map<number, { net: number; gp: number | null; months: number }>();
  for (const m of all) { const y = fiscal(m.m + "-01", s.cal).fy; const t = fyT.get(y) ?? { net: 0, gp: 0, months: 0 }; t.net += m.net; t.gp = m.gp === null || t.gp === null ? null : t.gp + m.gp; t.months++; fyT.set(y, t); }
  const fyEnd = (y: number) => { const m = s.cal.fiscalStartMonth; const start = `${m === 1 ? y : y - 1}-${String(m).padStart(2, "0")}-01`; const e = periodOf("year", start, s.cal).end; return e < s.asOf ? e : s.asOf; };
  blocks.push({ t: "rank", title: "Net sales by fiscal year", sub: "Partial years marked · click to open", money: true, rows: [...fyT].sort((a, b) => a[0] - b[0]).map(([y, t]) => ({ label: `FY${y}${t.months < 12 ? ` (${t.months} mo)` : ""}`, value: t.net, href: siHref(s, "/si/yearly", { asOf: fyEnd(y), g: "year" }) })) });
  const qRows = [];
  for (let q = 0; q < 4; q++) {
    const qs = new Date(Date.UTC(+s.pc.full.start.slice(0, 4), +s.pc.full.start.slice(5, 7) - 1 + 3 * q, 1)).toISOString().slice(0, 10);
    const qe = addDays(new Date(Date.UTC(+qs.slice(0, 4), +qs.slice(5, 7) - 1 + 3, 1)).toISOString().slice(0, 10), -1);
    const ser = await dailySeries(s.f, { start: addYears(qs, -1), end: qe });
    const c = qs > s.asOf ? null : bucketSum(ser, { start: qs, end: qe < s.asOf ? qe : s.asOf }).net;
    const p = bucketSum(ser, { start: addYears(qs, -1), end: addYears(qe, -1) }).net;
    qRows.push({ q: `Q${q + 1}${qe > s.asOf && qs <= s.asOf ? " (to date)" : ""}`, cur: c, prev: p, g: c === null ? null : growth(c, p) });
  }
  blocks.push({ t: "table", title: "Four fiscal quarters vs last year", cols: [{ key: "q", label: "Quarter" }, { key: "cur", label: "This FY", type: "money" }, { key: "prev", label: "Last FY (full quarter)", type: "money" }, { key: "g", label: "YoY", type: "pct" }], rows: qRows });
  blocks.push(await rankBlock(s, "category", "Category ranking"), await rankBlock(s, "customer", "Strategic customers"));
  return { title: titles.year, layer: "INVOICED", blocks, showGrain: true };
}

async function moversBlock(s: SiScope, dim: "customer" | "item", title: string): Promise<Block> {
  if (!s.pc.comparison) return { t: "note", text: `${title}: choose a comparison to see movers.` };
  const rows = await invBy(s.f, dim, s.pc.current, s.pc.comparison, 2000);
  const m = rows.map((r) => ({ ...r, d: r.cur - r.prev })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 25);
  return { t: "table", title, sub: `Largest absolute change vs ${s.pc.comparisonLabel}`, maxHeight: 360, cols: [
    { key: "label", label: dim === "customer" ? "Customer" : "Item", href: dim === "customer" ? tpl(s, "/si/customer", { c: "{key}" }) : tpl(s, "/si/products", { item: "{key}" }) },
    { key: "prev", label: "Comparison", type: "money" }, { key: "cur", label: "Current", type: "money" }, { key: "d", label: "Change", type: "money", tone: "signed" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }],
    rows: m.map((x) => ({ ...x, g: growth(x.cur, x.prev) })) };
}

// ------------------------------------------------------------------ 07 Revenue & growth decomposition
export async function pvmScreen(s: SiScope, k: K): Promise<Screen> {
  if (!s.pc.comparison) return { title: "Revenue & Growth Decomposition", layer: "INVOICED", blocks: [{ t: "note", text: "Choose a comparison (last year or previous period) to build the bridge." }] };
  const b = await pvm(s.f, s.pc.current, s.pc.comparison);
  const names = new Map((await sql<{ item: string; name: string }[]>`select item, name from si.product where company = ${s.f.company}`).map((x) => [x.item, x.name]));
  return { title: "Revenue & Growth Decomposition", layer: "INVOICED", blocks: [
    { t: "kpis", ids: ["REV-004", "REV-005", "PRI-002", "PRI-008", "PRD-001", "REV-003"] },
    { ...(await pvmBlock(s))!, wide: true } as Block,
    { t: "table", title: "Bridge components", cols: [{ key: "c", label: "Effect" }, { key: "v", label: s.co.currency, type: "money", tone: "signed" }, { key: "how", label: "How it is computed", wrap: true }], rows: [
      { c: "Base net sales", v: b.base, how: `${s.pc.comparisonLabel}: invoices, physical returns and allowances` },
      { c: "Volume", v: b.volume, how: "(Total matched units now − before) × base average price of matched SKUs" },
      { c: "Mix", v: b.mix, how: "Σ base price × unit change per SKU − Volume (shift between cheaper and dearer SKUs)" },
      { c: "Price", v: b.price, how: "Σ (current − base net unit price) × current units, per SKU; includes FX translation on USD lines (FX-neutral view not built)" },
      { c: "New SKUs", v: b.newItems, how: "Revenue of SKUs sold now but not in the base" }, { c: "Lost SKUs", v: b.lost, how: "Base revenue of SKUs not sold now" },
      { c: "Commercial allowances", v: b.credits, how: "Change in price-only credit notes (no units)" }, { c: "Other", v: b.other, how: "SKUs with revenue but zero net units on one side" },
      { c: "Current net sales", v: b.current, how: s.pc.label }, { c: "Unexplained residual", v: b.residual, how: "Must be 0.00 — checked on Reconciliation" }],
      total: undefined },
    { t: "table", title: "Largest SKU drivers", cols: [{ key: "name", label: "Item", href: tpl(s, "/si/products", { item: "{item}" }) }, { key: "change", label: "Change", type: "money", tone: "signed" }, { key: "volume", label: "Volume + mix", type: "money", tone: "signed" }, { key: "price", label: "Price", type: "money", tone: "signed" }],
      rows: b.drivers.map((d) => ({ ...d, name: names.get(d.item) ?? d.item })) },
  ], footnote: "Method: fixed-order item-level attribution (spec §10.3), version pvm-v1. Customer mix and FX are not separated yet." };
}

// ------------------------------------------------------------------ 08 Actual vs target
export async function targetScreen(s: SiScope, k: K): Promise<Screen> {
  const td = (a: string, b: string) => tradingDays(a, b, s.cal);
  const reps = await invBy({ ...s.f, dims: { ...s.f.dims } }, "salesperson", s.pc.current, s.pc.comparison, 100);
  const all = await sql<{ code: string; name: string; territory: string }[]>`select code, name, territory from si.salesperson where company = ${s.f.company} ${s.pinnedRep ? sql`and code = ${s.pinnedRep}` : sql``} order by name`;
  const rows = await Promise.all(all.map(async (r) => {
    const a = reps.find((x) => x.key === r.code);
    const f = withDim(s.f, "salesperson", r.code);
    const [tp, tf] = await Promise.all([targetFor(f, s.pc.current, td), targetFor(f, s.pc.full, td)]);
    const actual = a?.cur ?? 0;
    return { code: r.code, name: r.name, territory: r.territory, actual, prorated: tp.amount, target: tf.amount, att: tf.amount ? actual / tf.amount : null, pace: tp.amount ? actual / tp.amount : null, gap: tf.amount === null ? null : actual - tf.amount, ly: a?.prev ?? null, g: a ? growth(a.cur, a.prev) : null };
  }));
  const versions = await sql<any[]>`select version, status, count(*)::int n, min(month) from_m, max(month) to_m, sum(amount) amount from si.target where company = ${s.f.company} group by 1,2 order by 1,2`;
  return { title: "Actual vs Target", layer: "INVOICED vs APPROVED TARGET", blocks: [
    { t: "kpis", ids: ["TAR-001", "TAR-002", "TAR-003", "TAR-005", "TAR-006", "TAR-007", "TAR-008", "TAR-012", "TEA-002", "REV-004", "REV-013", "REV-014"] },
    await trendBlock(s, "Cumulative actual vs approved target"),
    { t: "rank", title: "Pace attainment by salesperson", sub: "Actual ÷ pro-rated target", money: false, rows: rows.filter((r) => r.pace !== null).sort((a, b) => b.pace! - a.pace!).map((r) => ({ label: r.name, value: Math.round(r.pace! * 100), sub: `${r.code}`, href: siHref(s, "/si/targets", { salesperson: r.code }) })) },
    { t: "table", title: "Target versions", cols: [{ key: "version", label: "Version", type: "int" }, { key: "status", label: "Status" }, { key: "n", label: "Rows", type: "int" }, { key: "from_m", label: "From", type: "date" }, { key: "to_m", label: "To", type: "date" }, { key: "amount", label: "Total", type: "money" }], rows: versions },
    { t: "table", title: "Salesperson scoreboard", cols: [{ key: "name", label: "Salesperson", href: tpl(s, "/si/team", { salesperson: "{code}" }) }, { key: "territory", label: "Territory" }, { key: "actual", label: "Actual", type: "money" },
      { key: "prorated", label: "Target to date", type: "money" }, { key: "pace", label: "Pace", type: "pct" }, { key: "target", label: "Full-period target", type: "money" }, { key: "att", label: "Attainment", type: "pct" }, { key: "gap", label: "Gap", type: "money", tone: "signed" }, { key: "ly", label: "Comparison", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }],
      rows, total: { name: "Total", actual: rows.reduce((a, r) => a + r.actual, 0), prorated: rows.reduce((a, r) => a + (r.prorated ?? 0), 0), target: rows.reduce((a, r) => a + (r.target ?? 0), 0), gap: rows.reduce((a, r) => a + (r.gap ?? 0), 0) } },
  ], footnote: "Only the approved version counts (a superseded version is kept for audit). Partial months are pro-rated by trading days. Targets exist per salesperson and month; with customer/product filters, target KPIs are not comparable." };
}

// ------------------------------------------------------------------ 10–12 orders & backlog
export async function ordersScreen(s: SiScope, k: K): Promise<Screen> {
  const bl = await backlogAsOf(s.f, s.pc.current.end);
  const det = (await backlogAsOf(s.f, s.pc.current.end, true)).rows as any[];
  const months = await sql<any[]>`
    select to_char(created,'YYYY-MM') m, sum(net_mst) intake from si.order_line ol left join si.customer c on c.company = ol.company and c.account = ol.customer
      left join si.product p on p.company = ol.company and p.item = ol.item
    where ol.company = ${s.f.company} and created between ${addDays(s.asOf, -365)} and ${s.asOf} ${olWhere(s.f).frag} group by 1 order by 1`;
  const inv = new Map((await netByMonth(s.f)).map((m) => [m.m, m.net]));
  const cancelled = await sql<any[]>`
    select ol.order_id, ol.line_no, ol.cancelled_date, c.name customer, p.name item, ol.cancelled_qty, ol.net_mst * ol.cancelled_qty / nullif(ol.qty,0) value, ol.salesperson, ol.status
    from si.order_line ol left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
    where ol.company = ${s.f.company} and ol.cancelled_date between ${s.pc.current.start} and ${s.pc.current.end} ${olWhere(s.f).frag} order by value desc limit 200`;
  return { title: "Order Intake, Backlog & Cancellations", layer: "ORDERED (created / confirmed) · SNAPSHOT", blocks: [
    { t: "kpis", ids: ["ORD-001", "ORD-002", "ORD-003", "ORD-004", "ORD-012", "ORD-011", "ORD-005", "ORD-006", "ORD-007", "ORD-008", "ORD-014", "ORD-015"] },
    { t: "kpis", ids: ["ORD-009", "ORD-010", "INV-001", "FUL-003", "TAR-012", "REV-004"] },
    { t: "trend", wide: true, title: "Order intake vs invoiced net sales · last 12 months", sub: "Different event dates: order creation vs invoice posting", curName: "Order intake", prevName: "Invoiced net sales",
      data: months.map((m) => ({ label: `${MON[+m.m.slice(5) - 1]} ${m.m.slice(2, 4)}`, cur: r0(m.intake), prev: r0(inv.get(m.m) ?? 0), href: siHref(s, "/si/orders", { asOf: new Date(Date.UTC(+m.m.slice(0, 4), +m.m.slice(5), 0)).toISOString().slice(0, 10), g: "month" }) })) },
    { t: "rank", title: "Backlog by age (as of period end)", sub: "Days since order creation", rows: ["0–7 days", "8–14", "15–30", "31–60", "Over 60"].map((l, i) => ({ label: l, value: bl.buckets[i] })) },
    { t: "donut", title: "Backlog status", data: [{ label: "On time", value: bl.value - bl.overdue - bl.holdValue }, { label: "Past confirmed date", value: bl.overdue }, { label: "On hold", value: bl.holdValue }].filter((x) => x.value > 0), center: `${(bl.value / 1e6).toFixed(1)}M`, centerLabel: "open" },
    { t: "table", title: "Open order lines (largest first)", sub: `As of ${s.pc.current.end}`, cols: [{ key: "order_id", label: "Order" }, { key: "line_no", label: "Line", type: "int" }, { key: "customer_name", label: "Customer", href: tpl(s, "/si/customer", { c: "{customer}" }) },
      { key: "item_name", label: "Item" }, { key: "created", label: "Created", type: "date" }, { key: "confirmed_ship", label: "Confirmed ship", type: "date" }, { key: "open_qty", label: "Open qty", type: "num" }, { key: "open_value", label: "Open value", type: "money" },
      { key: "age", label: "Age (d)", type: "int" }, { key: "overdue", label: "Past due" }, { key: "hold", label: "Hold" }, { key: "salesperson", label: "Rep" }], rows: det.map((r) => ({ ...r, overdue: r.overdue ? "Yes" : "" })) },
    { t: "table", title: "Cancellations in the period", cols: [{ key: "cancelled_date", label: "Cancelled", type: "date" }, { key: "order_id", label: "Order" }, { key: "line_no", label: "Line", type: "int" }, { key: "customer", label: "Customer" }, { key: "item", label: "Item" }, { key: "cancelled_qty", label: "Qty", type: "num" }, { key: "value", label: "Value", type: "money" }, { key: "status", label: "Line status" }, { key: "salesperson", label: "Rep" }], rows: cancelled },
  ], footnote: "Backlog = ordered − delivered − cancelled, valued at the line's net unit price, as of the period end. Order change history (reprices, edits) is not available from the source (ORD-016 BLOCKED BY SOURCE)." };
}

// ------------------------------------------------------------------ 13–14 delivery & unbilled
export async function fulfilmentScreen(s: SiScope, k: K): Promise<Screen> {
  const weeks = [];
  const ws = weekStartOf(s.asOf, s.cal);
  for (let i = 11; i >= 0; i--) {
    const st = addDays(ws, -7 * i), en = addDays(st, 6) > s.asOf ? s.asOf : addDays(st, 6);
    const d = await delAgg(s.f, { start: st, end: en });
    weeks.push({ label: `${+st.slice(8)} ${MON[+st.slice(5, 7) - 1]}`, cur: d.otifLines ? Math.round((d.otif / d.otifLines) * 1000) / 10 : null, prev: d.otifLines ? Math.round((d.ontime / d.otifLines) * 1000) / 10 : null, href: siHref(s, "/si/fulfilment", { asOf: en, g: "week" }) });
  }
  const dni = await sql<any[]>`
    with sl as (select order_id, line_no, sum(qty) q, max(delivery_date) last_slip from si.slip_line where company = ${s.f.company} and delivery_date <= ${s.pc.current.end} group by 1,2),
         iv as (select order_id, order_line, sum(qty) q from si.invoice_line where company = ${s.f.company} and doc_type = 'invoice' and invoice_date <= ${s.pc.current.end} group by 1,2)
    select ol.order_id, ol.line_no, c.name customer, ol.customer cust, p.name item, sl.q dq, coalesce(iv.q,0) iq, sl.q - coalesce(iv.q,0) unbilled_qty,
      (sl.q - coalesce(iv.q,0)) * ol.net_mst / nullif(ol.qty,0) unbilled_value, sl.last_slip, ${s.pc.current.end}::date - sl.last_slip age
    from si.order_line ol join sl on sl.order_id = ol.order_id and sl.line_no = ol.line_no left join iv on iv.order_id = ol.order_id and iv.order_line = ol.line_no
      left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
    where ol.company = ${s.f.company} and sl.q - coalesce(iv.q,0) > 0.000001 ${olWhere(s.f).frag} order by unbilled_value desc limit 300`;
  const wh = await sql<any[]>`
    select s.warehouse, w.name, sum(s.value_mst) value, sum(s.qty) qty, count(distinct s.slip_id)::int slips from si.slip_line s join si.order_line ol on ol.company = s.company and ol.order_id = s.order_id and ol.line_no = s.line_no
      left join si.warehouse w on w.company = s.company and w.code = s.warehouse left join si.customer c on c.company = ol.company and c.account = ol.customer left join si.product p on p.company = ol.company and p.item = ol.item
    where s.company = ${s.f.company} and s.delivery_date between ${s.pc.current.start} and ${s.pc.current.end} ${olWhere(s.f).frag} group by 1,2 order by 3 desc`;
  const noSlips = s.co.mode !== "DEMO" && ((k.get("FUL-002")?.v as number) ?? 0) === 0;
  return { title: "Delivery, OTIF & Unbilled Deliveries", layer: "DELIVERED (packing-slip date) · SNAPSHOT", blocks: [
    ...(noSlips ? [{ t: "note" as const, tone: "warn" as const, text: "BLOCKED BY SOURCE: packing-slip lines are not synced for this company, so delivery KPIs are empty rather than estimated." }] : []),
    { t: "kpis", ids: ["FUL-001", "FUL-002", "FUL-004", "FUL-005", "FUL-006", "FUL-007", "FUL-009", "FUL-011", "FUL-012", "FUL-003", "ORD-008", "ORD-005"] },
    { t: "trend", wide: true, title: "OTIF and on-time % · last 12 weeks", sub: "Lines whose confirmed ship date falls in the week", curName: "OTIF %", prevName: "On-time %", data: weeks },
    { t: "rank", title: "Deliveries by warehouse", rows: wh.map((w) => ({ label: w.name ?? w.warehouse, value: w.value, sub: `${w.slips} slips`, href: siHref(s, "/si/fulfilment", { warehouse: w.warehouse }) })) },
    { t: "rank", title: "Unbilled deliveries by age", rows: [["0–3 days", 0, 3], ["4–7 days", 4, 7], ["8–14 days", 8, 14], ["Over 14 days", 15, 99999]].map(([l, a, b]) => ({ label: String(l), value: dni.filter((x) => x.age >= (a as number) && x.age <= (b as number)).reduce((t, x) => t + x.unbilled_value, 0) })) },
    { t: "table", title: "Delivered not invoiced (as of period end)", cols: [{ key: "order_id", label: "Order" }, { key: "line_no", label: "Line", type: "int" }, { key: "customer", label: "Customer", href: tpl(s, "/si/customer", { c: "{cust}" }) }, { key: "item", label: "Item" },
      { key: "dq", label: "Delivered", type: "num" }, { key: "iq", label: "Invoiced", type: "num" }, { key: "unbilled_qty", label: "Unbilled qty", type: "num" }, { key: "unbilled_value", label: "Unbilled value", type: "money" }, { key: "last_slip", label: "Last slip", type: "date" }, { key: "age", label: "Age (d)", type: "int" }], rows: dni },
  ], footnote: "OTIF: an order line counts when its full remaining quantity was delivered on or before the confirmed ship date (cancellations excluded). Partial deliveries are separate slip events and never multiply order value." };
}

// ------------------------------------------------------------------ 15 invoices & credits
export async function invoicesScreen(s: SiScope, k: K): Promise<Screen> {
  const docType = s.q.doc === "invoice" || s.q.doc === "credit" ? s.q.doc : undefined;
  const rows = await invLines(s.f, s.pc.current, { limit: 2000, docType });
  const daily = await sql<any[]>`
    select il.invoice_date d, count(distinct case when doc_type='invoice' then invoice_id end)::int invoices, count(distinct case when doc_type='credit' then invoice_id end)::int credits,
      sum(case when doc_type='invoice' then net_mst else 0 end) inv_net, sum(case when doc_type='credit' then net_mst else 0 end) cr_net, sum(net_mst) net, sum(tax * fx_rate) tax
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} group by 1 order by 1 desc`;
  const cur = await sql<any[]>`
    select il.currency, count(*)::int lines, sum(net) net_doc, sum(net_mst) net_mst, count(*) filter (where net_mst is null)::int untranslated
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} group by 1 order by 2 desc`;
  const billTo = await sql<any[]>`
    select il.customer, c.name, il.invoice_account, b.name bill_name, sum(net_mst) net, count(distinct invoice_id)::int docs
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.customer b on b.company = il.company and b.account = il.invoice_account
      left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.customer <> il.invoice_account and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} group by 1,2,3,4 order by 5 desc`;
  return { title: "Invoice & Credit Note Explorer", layer: "INVOICED (invoice date)", blocks: [
    { t: "kpis", ids: ["REV-001", "REV-002", "REV-003", "REV-004", "RET-008", "PRI-004", "REV-013", "CUS-001", "PRD-001", "MAR-003", "RET-001", "RET-002"] },
    { t: "table", title: "Amounts by document currency", sub: "Never summed across currencies; accounting-currency column is the translated total", cols: [{ key: "currency", label: "Document currency" }, { key: "lines", label: "Lines", type: "int" }, { key: "net_doc", label: "Net (document currency)", type: "money" }, { key: "net_mst", label: `Net (${s.co.currency})`, type: "money" }, { key: "untranslated", label: "Lines without FX", type: "int", tone: "badIfPositive" }], rows: cur },
    { t: "table", title: "Daily invoice summary", maxHeight: 320, cols: [{ key: "d", label: "Date", type: "date", href: tpl(s, "/si/daily", { asOf: "{d}", g: "day" }) }, { key: "invoices", label: "Invoices", type: "int" }, { key: "credits", label: "Credit notes", type: "int" }, { key: "inv_net", label: "Invoiced", type: "money" }, { key: "cr_net", label: "Credits", type: "money", tone: "signed" }, { key: "net", label: "Net sales", type: "money" }, { key: "tax", label: "VAT (excluded)", type: "money" }],
      rows: daily, total: { d: "Total", invoices: daily.reduce((a, r) => a + r.invoices, 0), credits: daily.reduce((a, r) => a + r.credits, 0), inv_net: daily.reduce((a, r) => a + r.inv_net, 0), cr_net: daily.reduce((a, r) => a + r.cr_net, 0), net: daily.reduce((a, r) => a + r.net, 0), tax: daily.reduce((a, r) => a + r.tax, 0) } },
    { t: "table", title: "Sold-to differs from invoice account", sub: "Revenue stays with the sold-to customer; receivables with the invoice account", maxHeight: 280, cols: [{ key: "name", label: "Sold-to", href: tpl(s, "/si/customer", { c: "{customer}" }) }, { key: "bill_name", label: "Invoice account" }, { key: "docs", label: "Documents", type: "int" }, { key: "net", label: "Net", type: "money" }], rows: billTo },
    { t: "table", title: `Invoice and credit lines${docType ? ` · ${docType}s only` : ""}`, sub: `${rows.length.toLocaleString()} lines (capped at 2,000; narrow the filters for more)`, cols: [...LINE_COLS(s), { key: "credit_class", label: "Credit class" }, { key: "original_invoice_line_key", label: "Original line" }], rows, maxHeight: 620 },
  ] };
}

// ------------------------------------------------------------------ 16 customer 360
export async function customerScreen(s: SiScope, kAll: K, compute: (s: SiScope) => Promise<K>): Promise<Screen> {
  const c = s.q.c;
  const [cu] = c ? await sql<any[]>`select c.*, t.name territory_name, ch.name channel_name, b.name bill_name from si.customer c left join si.territory t on t.company = c.company and t.code = c.territory left join si.channel ch on ch.company = c.company and ch.code = c.channel left join si.customer b on b.company = c.company and b.account = c.invoice_account where c.company = ${s.f.company} and c.account = ${c}` : [];
  if (!cu) return { title: "Customer 360°", layer: "ALL LAYERS", blocks: [{ t: "note", text: "Pick a customer from any ranking or table (or Customers) to open the 360° view." }] };
  const sc: SiScope = { ...s, f: withDim(s.f, "customer", c!) };
  const k = await compute(sc);
  const months = await sql<any[]>`select to_char(invoice_date,'YYYY-MM') m, sum(net_mst) net, sum(net_mst) - sum(cogs_mst) gp from si.invoice_line where company = ${s.f.company} and customer = ${c} and invoice_date between ${addDays(s.asOf, -730)} and ${s.asOf} group by 1 order by 1`;
  const items = await invBy(sc.f, "item", s.pc.current, s.pc.comparison, 15);
  const openAr = await sql<any[]>`
    with st as (${settledAsOf(s.f.company, s.pc.current.end)})
    select t.trans_id, t.doc_type, t.doc_id, t.trans_date, t.due_date, t.amount, t.amount - sign(t.amount) * coalesce(st.amount,0) open, ${s.pc.current.end}::date - t.due_date days_late
    from si.ar_trans t left join st on st.trans = t.trans_id where t.company = ${s.f.company} and t.customer = ${cu.invoice_account} and t.trans_date <= ${s.pc.current.end}`;
  const ar = openAr.filter((r) => Math.abs(r.open) >= 0.005).sort((a, b) => b.days_late - a.days_late);
  const [last] = await sql<{ d: string | null }[]>`select max(invoice_date) d from si.invoice_line where company = ${s.f.company} and customer = ${c} and doc_type = 'invoice' and invoice_date <= ${s.asOf}`;
  const lines = await invLines(sc.f, { start: addDays(s.asOf, -365), end: s.asOf }, { limit: 300 });
  return { title: `Customer 360° · ${cu.name}`, sub: `${cu.account} · tier ${cu.tier ?? "–"} · ${cu.territory_name ?? cu.territory ?? "–"} · ${cu.channel_name ?? "–"} · invoice account ${cu.invoice_account}${cu.invoice_account !== cu.account ? ` (${cu.bill_name})` : ""} · terms ${cu.terms_days ?? "–"} days · credit limit ${s.co.currency} ${Number(cu.credit_limit ?? 0).toLocaleString("en-US")} · last purchase ${last?.d ?? "–"}`, layer: "ALL LAYERS", blocks: [
    { t: "kpis", title: "Sales & trends", ids: ["REV-004", "REV-005", "MAR-002", "MAR-003", "CUS-007", "PRD-001", "ORD-002", "ORD-005", "FUL-004", "RET-001", "RET-002", "PRI-004"] },
    { t: "kpis", title: "Receivables & risk (invoice account)", ids: ["AR-001", "AR-002", "AR-003", "AR-007", "AR-008", "AR-014"] },
    { t: "trend", wide: true, title: "Monthly net sales · last 24 months", curName: "Net sales", data: months.map((m) => ({ label: `${MON[+m.m.slice(5) - 1]} ${m.m.slice(2, 4)}`, cur: r0(m.net), href: siHref(sc, "/si/monthly", { asOf: new Date(Date.UTC(+m.m.slice(0, 4), +m.m.slice(5), 0)).toISOString().slice(0, 10) > s.asOf ? s.asOf : new Date(Date.UTC(+m.m.slice(0, 4), +m.m.slice(5), 0)).toISOString().slice(0, 10), customer: c! }) })) },
    { t: "rank", title: "Top products bought", rows: items.map((i) => ({ label: i.label, value: i.cur, prev: s.pc.comparison ? i.prev : null })) },
    { t: "table", title: "Open receivables", sub: `As of ${s.pc.current.end}`, cols: [{ key: "doc_id", label: "Document" }, { key: "doc_type", label: "Type" }, { key: "trans_date", label: "Date", type: "date" }, { key: "due_date", label: "Due", type: "date" }, { key: "amount", label: "Amount", type: "money" }, { key: "open", label: "Open", type: "money" }, { key: "days_late", label: "Days late", type: "int", tone: "badIfPositive" }], rows: ar, maxHeight: 300 },
    { t: "table", title: "Invoices, credit notes and lines · last 12 months", cols: LINE_COLS(s).filter((x) => x.key !== "customer_name"), rows: lines, maxHeight: 420 },
  ] };
}

// ------------------------------------------------------------------ 18–19 customers
export async function customersScreen(s: SiScope, k: K): Promise<Screen> {
  const all = await invBy(s.f, "customer", s.pc.current, s.pc.comparison, 2000);
  const freq = await sql<any[]>`
    select il.customer, count(distinct invoice_id)::int invoices, min(invoice_date) first_in_period, max(invoice_date) last_in_period,
      (select min(x.invoice_date) from si.invoice_line x where x.company = il.company and x.customer = il.customer and x.doc_type = 'invoice') first_ever
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} group by il.customer, il.company`;
  const fm = new Map(freq.map((x) => [x.customer, x]));
  const rows = all.map((c) => ({ ...c, g: growth(c.cur, c.prev), invoices: fm.get(c.key)?.invoices ?? 0, first_ever: fm.get(c.key)?.first_ever ?? null, isNew: (fm.get(c.key)?.first_ever ?? "") >= s.pc.current.start ? "New" : "", gm: c.gp === null ? null : safeDiv(c.gp, c.cur) }));
  const dormant = await sql<any[]>`
    select il.customer, c.name, max(invoice_date) last, ${s.asOf}::date - max(invoice_date) days, sum(net_mst) filter (where invoice_date > ${addDays(s.asOf, -730)}) net_2y
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.invoice_date <= ${s.asOf} ${ilWhere(s.f).frag} group by 1,2 having ${s.asOf}::date - max(invoice_date) > 90 order by 5 desc nulls last limit 100`;
  return { title: "Customers: Acquisition, Retention & Concentration", layer: "INVOICED", blocks: [
    { t: "kpis", ids: ["CUS-001", "CUS-002", "CUS-003", "CUS-004", "CUS-005", "CUS-006", "CUS-007", "CUS-008", "CUS-011", "CUS-012", "CUS-016", "REV-004"] },
    { t: "pareto", title: "Concentration (Pareto)", sub: "Dashed line = 80%", rows: rows.slice(0, 80).map((c) => ({ label: c.label, value: c.cur, href: siHref(s, "/si/customer", { c: c.key }) })) },
    { t: "donut", title: "Active customers by status", data: [{ label: "New", value: (k.get("CUS-002")?.v as number) ?? 0 }, { label: "Returning", value: (k.get("CUS-003")?.v as number) ?? 0 }, { label: "Reactivated (gap > 180 d)", value: (k.get("CUS-004")?.v as number) ?? 0 }].filter((x) => x.value > 0), center: String(k.get("CUS-001")?.v ?? 0), centerLabel: "active" },
    { t: "table", title: "Customer ranking", cols: [{ key: "label", label: "Customer", href: tpl(s, "/si/customer", { c: "{key}" }) }, { key: "isNew", label: "" }, { key: "cur", label: "Net sales", type: "money" }, { key: "prev", label: "Comparison", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" },
      { key: "gp", label: "Gross profit", type: "money" }, { key: "gm", label: "GM %", type: "pct" }, { key: "invoices", label: "Invoices", type: "int" }, { key: "returns", label: "Returns", type: "money" }, { key: "first_ever", label: "First purchase", type: "date" }], rows },
    { t: "table", title: "Dormant customers (no invoice for 90+ days)", sub: "Sorted by value in the last two years", cols: [{ key: "name", label: "Customer", href: tpl(s, "/si/customer", { c: "{customer}" }) }, { key: "last", label: "Last invoice", type: "date" }, { key: "days", label: "Days since", type: "int" }, { key: "net_2y", label: "Net sales, last 2 years", type: "money" }], rows: dormant, maxHeight: 360 },
  ], footnote: "New = first-ever invoice inside the period; returning = bought within the 180 days before the period; reactivated = gap above 180 days. Distinct counts are recounted at every grain, never summed." };
}

// ------------------------------------------------------------------ 20–21 products
export async function productsScreen(s: SiScope, k: K): Promise<Screen> {
  const items = await invBy(s.f, "item", s.pc.current, s.pc.comparison, 5000);
  const meta = new Map((await sql<any[]>`select item, category, brand, uom from si.product where company = ${s.f.company}`).map((x) => [x.item, x]));
  const tot = items.reduce((a, x) => a + Math.max(0, x.cur), 0) || 1;
  let acc = 0;
  const rows = items.map((x, i) => { acc += Math.max(0, x.cur); const sh = acc / tot; return { ...x, rank: i + 1, abc: sh <= 0.8 ? "A" : sh <= 0.95 ? "B" : "C", share: x.cur / tot, g: growth(x.cur, x.prev), asp: safeDiv(x.cur + x.returns, x.qty), gm: x.gp === null ? null : safeDiv(x.gp, x.cur), retRate: safeDiv(x.returns, x.cur + x.returns), ...meta.get(x.key) }; });
  const declining = rows.filter((r) => r.prev > 0 && r.g !== null && r.g < -0.2).sort((a, b) => (a.cur - a.prev) - (b.cur - b.prev)).slice(0, 50);
  const brands = await invBy(s.f, "brand", s.pc.current, s.pc.comparison, 20);
  return { title: "Products, SKUs & Categories", layer: "INVOICED", blocks: [
    { t: "kpis", ids: ["PRD-001", "PRD-002", "PRD-003", "PRD-004", "PRD-005", "PRD-006", "PRD-007", "PRD-008", "PRD-009", "PRD-010", "MAR-003", "REV-004"] },
    await rankBlock(s, "category", "Category performance"),
    { t: "donut", title: "Brand mix", data: brands.map((b) => ({ label: b.label, value: b.cur })), center: `${brands.length}`, centerLabel: "brands" },
    { t: "pareto", title: "SKU ABC curve", sub: `A = ${rows.filter((r) => r.abc === "A").length} SKUs (80% of revenue)`, rows: rows.slice(0, 120).map((r) => ({ label: r.label, value: r.cur })) },
    { t: "table", title: "Declining SKUs (down more than 20%)", cols: [{ key: "label", label: "Item" }, { key: "category", label: "Category" }, { key: "prev", label: "Comparison", type: "money" }, { key: "cur", label: "Current", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }], rows: declining, maxHeight: 320 },
    { t: "table", title: "SKU detail & ABC", cols: [{ key: "rank", label: "#", type: "int" }, { key: "key", label: "Item no." }, { key: "label", label: "Item" }, { key: "category", label: "Category" }, { key: "brand", label: "Brand" }, { key: "abc", label: "ABC" }, { key: "qty", label: "Units", type: "num" }, { key: "uom", label: "UOM" },
      { key: "asp", label: "Net ASP", type: "money" }, { key: "cur", label: "Net sales", type: "money" }, { key: "share", label: "Share", type: "pct" }, { key: "prev", label: "Comparison", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }, { key: "gp", label: "Gross profit", type: "money" }, { key: "gm", label: "GM %", type: "pct" }, { key: "retRate", label: "Return rate", type: "pct" }], rows },
  ], footnote: "Units are in each item's sales UOM; ASP is computed per SKU and never averaged across UOMs. Product images are not shown (no authorised asset source)." };
}

// ------------------------------------------------------------------ 22 pricing
export async function pricingScreen(s: SiScope, k: K): Promise<Screen> {
  const v = (id: string) => (k.get(id)?.v as number) ?? 0;
  const disp = await sql<any[]>`
    select il.item, p.name, p.list_price, count(*)::int lines, min(net_mst / nullif(qty,0)) min_p, max(net_mst / nullif(qty,0)) max_p, sum(net_mst) / nullif(sum(qty),0) avg_p,
      stddev_samp(net_mst / nullif(qty,0)) / nullif(avg(net_mst / nullif(qty,0)),0) cv, sum(coalesce(discount_mst, discount*fx_rate)) / nullif(sum(coalesce(gross_mst, gross*fx_rate)),0) disc
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.qty > 0 and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag}
    group by 1,2,3 having count(*) >= 3 order by cv desc nulls last limit 100`;
  const byTier = await invBy(s.f, "tier", s.pc.current, null, 10);
  const byRep = await invBy(s.f, "salesperson", s.pc.current, null, 50);
  const disc = await sql<any[]>`
    select il.invoice_date, il.invoice_id, c.name customer, il.customer cust, p.name item, il.qty, coalesce(il.gross_mst, il.gross*il.fx_rate) gross, coalesce(il.discount_mst, il.discount*il.fx_rate) discount,
      coalesce(il.discount_mst, il.discount*il.fx_rate) / nullif(coalesce(il.gross_mst, il.gross*il.fx_rate),0) pct, il.net_mst, il.salesperson
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} order by pct desc nulls last, discount desc limit 200`;
  return { title: "Pricing & Discounts", layer: "INVOICED", blocks: [
    { t: "kpis", ids: ["PRI-002", "PRI-003", "PRI-004", "PRI-008", "PRI-011", "TEA-007", "REV-001", "REV-002", "RET-002", "REV-004", "MAR-003", "PRD-002"] },
    { t: "waterfall", title: "Price waterfall", sub: "Gross → line discount → allowances → returns → net", steps: [
      { label: "Gross", value: v("REV-001"), total: true }, { label: "Line discount", value: -v("REV-002") }, { label: "Allowances", value: -v("RET-002") }, { label: "Returns", value: -v("RET-001") }, { label: "Net", value: v("REV-004"), total: true }] },
    { t: "rank", title: "Discount rate by salesperson", sub: "Discount ÷ gross, %", money: false, rows: byRep.filter((r) => r.gross > 0).map((r) => ({ label: r.label, value: Math.round((r.discount / r.gross) * 1000) / 10, href: siHref(s, "/si/pricing", { salesperson: r.key }) })).sort((a, b) => b.value - a.value) },
    { t: "table", title: "Discount by customer tier", cols: [{ key: "label", label: "Tier" }, { key: "gross", label: "Gross", type: "money" }, { key: "discount", label: "Discount", type: "money" }, { key: "rate", label: "Rate", type: "pct" }, { key: "cur", label: "Net", type: "money" }], rows: byTier.map((t) => ({ ...t, label: `Tier ${t.key}`, rate: safeDiv(t.discount, t.gross) })) },
    { t: "table", title: "Net price dispersion by SKU", sub: "Highest coefficient of variation first (≥ 3 lines)", cols: [{ key: "name", label: "Item" }, { key: "lines", label: "Lines", type: "int" }, { key: "list_price", label: "List price (demo)", type: "money" }, { key: "min_p", label: "Min net unit", type: "money" }, { key: "avg_p", label: "Avg net unit", type: "money" }, { key: "max_p", label: "Max net unit", type: "money" }, { key: "cv", label: "Dispersion (CV)", type: "pct" }, { key: "disc", label: "Avg discount", type: "pct" }], rows: disp, maxHeight: 360 },
    { t: "table", title: "Line discount audit (highest rates)", cols: [{ key: "invoice_date", label: "Date", type: "date" }, { key: "invoice_id", label: "Invoice" }, { key: "customer", label: "Customer", href: tpl(s, "/si/customer", { c: "{cust}" }) }, { key: "item", label: "Item" }, { key: "qty", label: "Qty", type: "num" }, { key: "gross", label: "Gross", type: "money" }, { key: "discount", label: "Discount", type: "money" }, { key: "pct", label: "Rate", type: "pct" }, { key: "net_mst", label: "Net", type: "money" }, { key: "salesperson", label: "Rep" }], rows: disc, maxHeight: 360 },
  ], footnote: "Line discounts on the invoice are separated from credits issued after the invoice. Promotions, trade agreements, rebates and price overrides are BLOCKED BY SOURCE (not synced)." };
}

// ------------------------------------------------------------------ 23–24 margin
export async function marginScreen(s: SiScope, k: K): Promise<Screen> {
  if (k.get("MAR-001")?.v === null) return { title: "Gross Margin & Profitability", layer: "INVOICED + COST", blocks: [{ t: "kpis", ids: ["REV-004", "MAR-001", "MAR-002", "MAR-003"] }, { t: "note", tone: "warn", text: "BLOCKED BY SOURCE: this company's synced invoice lines carry no posted cost, so gross profit is not shown rather than estimated from current item cost." }] };
  const tbl = async (dim: "customer" | "item" | "salesperson" | "territory" | "brand", title: string) => {
    const rows = (await invBy(s.f, dim, s.pc.current, null, 3000)).filter((r) => r.gp !== null).map((r) => ({ ...r, gm: safeDiv(r.gp!, r.cur) })).sort((a, b) => (b.gp ?? 0) - (a.gp ?? 0));
    return { t: "table" as const, title, maxHeight: 320, cols: [{ key: "label", label: title.split(" by ")[1] ?? "Member", ...(dim === "customer" ? { href: tpl(s, "/si/customer", { c: "{key}" }) } : {}) }, { key: "cur", label: "Net sales", type: "money" as const }, { key: "gp", label: "Gross profit", type: "money" as const, tone: "signed" as const }, { key: "gm", label: "GM %", type: "pct" as const }], rows };
  };
  const months = (await netByMonth(s.f)).filter((m) => m.m >= addDays(s.asOf, -730).slice(0, 7) && m.m <= s.asOf.slice(0, 7));
  const neg = await invLines(s.f, s.pc.current, { limit: 300, extra: sql`and il.doc_type = 'invoice' and il.cogs_mst is not null and il.net_mst < il.cogs_mst` });
  const adj = await sql<any[]>`select to_char(invoice_date,'YYYY-MM') m, sum(cogs_mst) posted, sum(cogs_restated_mst) restated, sum(cogs_restated_mst) - sum(cogs_mst) delta from si.invoice_line where company = ${s.f.company} and cogs_restated_mst is not null group by 1 having abs(sum(cogs_restated_mst) - sum(cogs_mst)) > 0.5 order by 1`;
  return { title: "Gross Margin & Profitability", layer: "INVOICED + POSTED COST", blocks: [
    { t: "kpis", ids: ["MAR-001", "MAR-002", "MAR-003", "MAR-004", "MAR-005", "MAR-007", "MAR-009", "PRI-011", "MAR-013", "MAR-014", "MAR-015", "MAR-016"] },
    { t: "trend", wide: true, title: "Monthly gross profit · last 24 months", curName: "Gross profit", prevName: "Net sales", data: months.map((m) => ({ label: `${MON[+m.m.slice(5) - 1]} ${m.m.slice(2, 4)}`, cur: r0(m.gp), prev: r0(m.net) })) },
    await tbl("customer", "Gross profit by customer"), await tbl("item", "Gross profit by SKU"), await tbl("salesperson", "Gross profit by salesperson"), await tbl("territory", "Gross profit by region"),
    { t: "table", title: "Cost restatements (as posted vs restated)", sub: "DEMO ONLY: restated cost exists in the demo dataset", cols: [{ key: "m", label: "Month" }, { key: "posted", label: "Posted COGS", type: "money" }, { key: "restated", label: "Restated COGS", type: "money" }, { key: "delta", label: "Delta", type: "money", tone: "badIfPositive" }], rows: adj },
    { t: "table", title: "Negative-margin lines", cols: LINE_COLS(s), rows: neg, maxHeight: 360 },
  ], footnote: "Gross profit uses the cost posted with each invoice line (as posted). Restated margin is shown separately; cost-to-serve and contribution profit are BLOCKED BY SOURCE." };
}

// ------------------------------------------------------------------ 25–26 team, territory, channel
export async function teamScreen(s: SiScope, k: K): Promise<Screen> {
  const td = (a: string, b: string) => tradingDays(a, b, s.cal);
  const reps = await invBy(s.f, "salesperson", s.pc.current, s.pc.comparison, 200);
  const meta = new Map((await sql<any[]>`select code, name, team, territory, manager from si.salesperson where company = ${s.f.company}`).map((x) => [x.code, x]));
  const custs = new Map((await sql<any[]>`
    select il.salesperson, count(distinct il.customer)::int n from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.invoice_date between ${s.pc.current.start} and ${s.pc.current.end} ${ilWhere(s.f).frag} group by 1`).map((x) => [x.salesperson, x.n]));
  const rows = await Promise.all(reps.map(async (r) => {
    const t = (await targetFor(withDim(s.f, "salesperson", r.key), s.pc.current, td)).amount;
    return { ...r, ...meta.get(r.key), g: growth(r.cur, r.prev), t, pace: t ? r.cur / t : null, gm: r.gp === null ? null : safeDiv(r.gp, r.cur), disc: safeDiv(r.discount, r.gross), customers: custs.get(r.key) ?? 0 };
  }));
  const wh = await invBy(s.f, "warehouse", s.pc.current, s.pc.comparison, 20);
  const tier = await invBy(s.f, "tier", s.pc.current, s.pc.comparison, 10);
  const chan = await invBy(s.f, "channel", s.pc.current, s.pc.comparison, 10);
  return { title: "Salesperson, Team, Territory & Channel", layer: "INVOICED", blocks: [
    { t: "kpis", ids: ["TEA-001", "TEA-002", "TEA-003", "TEA-004", "TEA-005", "TEA-007", "TEA-008", "TEA-010", "TEA-011", "TEA-012", "MAR-015", "REV-004"] },
    { t: "rank", title: "Leaderboard", rows: rows.map((r) => ({ label: r.name ?? r.label, value: r.cur, prev: s.pc.comparison ? r.prev : null, href: siHref(s, "/si/team", { salesperson: r.key }) })) },
    await rankBlock(s, "territory", "Territories"),
    { t: "donut", title: "Channel mix", data: chan.map((c) => ({ label: c.label, value: c.cur })), center: `${chan.length}`, centerLabel: "channels" },
    { t: "table", title: "Branch / warehouse contribution", cols: [{ key: "label", label: "Warehouse" }, { key: "cur", label: "Net sales", type: "money" }, { key: "share", label: "Share", type: "pct" }, { key: "prev", label: "Comparison", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }], rows: wh.map((w) => ({ ...w, share: safeDiv(w.cur, wh.reduce((a, x) => a + x.cur, 0)), g: growth(w.cur, w.prev) })) },
    { t: "table", title: "Salesperson scorecard", cols: [{ key: "name", label: "Salesperson", href: tpl(s, "/si/team", { salesperson: "{key}" }) }, { key: "team", label: "Team" }, { key: "territory", label: "Territory" }, { key: "cur", label: "Net sales", type: "money" }, { key: "t", label: "Target to date", type: "money" }, { key: "pace", label: "Pace", type: "pct" },
      { key: "g", label: "Growth", type: "pct", tone: "signed" }, { key: "gm", label: "GM %", type: "pct" }, { key: "disc", label: "Discount %", type: "pct" }, { key: "customers", label: "Customers", type: "int" }, { key: "returns", label: "Returns", type: "money" }], rows },
    { t: "table", title: "Sales by customer tier", cols: [{ key: "label", label: "Tier" }, { key: "cur", label: "Net sales", type: "money" }, { key: "prev", label: "Comparison", type: "money" }, { key: "g", label: "Growth", type: "pct", tone: "signed" }], rows: tier.map((t) => ({ ...t, label: `Tier ${t.key}`, g: growth(t.cur, t.prev) })) },
  ], footnote: "Sales are credited to the salesperson recorded on each invoice line at the event date (a customer reassigned mid-year keeps earlier sales with the earlier rep). Commission is not calculated here." };
}

// ------------------------------------------------------------------ 27 returns
export async function returnsScreen(s: SiScope, k: K): Promise<Screen> {
  const reasons = (await invBy(s.f, "reason", s.pc.current, s.pc.comparison, 20)).filter((r) => r.key !== "–");
  const byCust = (await invBy(s.f, "customer", s.pc.current, null, 3000)).filter((r) => r.returns > 0).sort((a, b) => b.returns - a.returns).slice(0, 50).map((r) => ({ ...r, rate: safeDiv(r.returns, r.cur + r.returns) }));
  const byItem = (await invBy(s.f, "item", s.pc.current, null, 5000)).filter((r) => r.returns > 0).sort((a, b) => b.returns - a.returns).slice(0, 50).map((r) => ({ ...r, rate: safeDiv(r.returns, r.cur + r.returns) }));
  const byRep = (await invBy(s.f, "salesperson", s.pc.current, null, 100)).filter((r) => r.returns > 0).sort((a, b) => b.returns - a.returns);
  const cohort = await sql<any[]>`
    select to_char(il.invoice_date,'YYYY-MM') m, sum(il.net_mst) sold, -coalesce(sum(r.net),0) returned
    from si.invoice_line il left join si.customer c on c.company = il.company and c.account = il.customer left join si.product p on p.company = il.company and p.item = il.item
      left join lateral (select sum(x.net_mst) net from si.invoice_line x where x.company = il.company and x.original_invoice_line_key = il.invoice_line_key and x.credit_class = 'physical_return' and x.invoice_date <= ${s.asOf}) r on true
    where il.company = ${s.f.company} and il.doc_type = 'invoice' and il.invoice_date between ${addDays(s.asOf, -365)} and ${s.asOf} ${ilWhere(s.f).frag}
    group by 1 order by 1`;
  const notes = await invLines(s.f, s.pc.current, { limit: 500, docType: "credit" });
  return { title: "Returns, Claims & Credit Notes", layer: "INVOICED (credit posting date) · COHORT", blocks: [
    { t: "kpis", ids: ["RET-001", "RET-002", "RET-003", "RET-004", "RET-005", "RET-007", "RET-008", "RET-009", "RET-010", "RET-012", "REV-003", "PRD-008"] },
    { t: "rank", title: "Returns by reason", rows: reasons.map((r) => ({ label: r.label, value: -r.cur, prev: s.pc.comparison ? -r.prev : null })) },
    { t: "rank", title: "Returns by salesperson", rows: byRep.map((r) => ({ label: r.label, value: r.returns, href: siHref(s, "/si/returns", { salesperson: r.key }) })) },
    { t: "table", title: "Return cohort by original invoice month", sub: "Physical returns traced to the original invoice line (cohort view) — differs from the posting-period rate by design", cols: [{ key: "m", label: "Original sale month" }, { key: "sold", label: "Invoiced", type: "money" }, { key: "returned", label: "Returned later", type: "money" }, { key: "rate", label: "Cohort return rate", type: "pct" }], rows: cohort.map((c) => ({ ...c, rate: safeDiv(c.returned ?? 0, c.sold ?? 0) })), maxHeight: 340 },
    { t: "table", title: "Returns by customer", maxHeight: 320, cols: [{ key: "label", label: "Customer", href: tpl(s, "/si/customer", { c: "{key}" }) }, { key: "returns", label: "Returned value", type: "money" }, { key: "rate", label: "Return rate", type: "pct" }], rows: byCust },
    { t: "table", title: "Returns by SKU", maxHeight: 320, cols: [{ key: "label", label: "Item" }, { key: "returns", label: "Returned value", type: "money" }, { key: "rate", label: "Return rate", type: "pct" }], rows: byItem },
    { t: "table", title: "Credit note register", cols: [...LINE_COLS(s), { key: "credit_class", label: "Class" }, { key: "return_reason", label: "Reason" }, { key: "original_invoice_line_key", label: "Original line" }], rows: notes, maxHeight: 420 },
  ], footnote: "Physical returns carry negative units; price-only allowances carry no units and are never counted as returned goods. Return processing time is BLOCKED BY SOURCE (return order dates not projected)." };
}

// ------------------------------------------------------------------ 28–29 AR, collections, credit
export async function arScreen(s: SiScope, k: K): Promise<Screen> {
  const d = s.pc.current.end;
  const docs = await sql<any[]>`
    with st as (${settledAsOf(s.f.company, d)})
    select t.customer, c.name, c.credit_limit, c.terms_days, t.doc_type, t.due_date, t.amount, t.amount - sign(t.amount) * coalesce(st.amount,0) open
    from si.ar_trans t left join st on st.trans = t.trans_id left join si.customer c on c.company = t.company and c.account = t.customer
    where t.company = ${s.f.company} and t.trans_date <= ${d} ${arWhere(s.f).frag}`;
  const by = new Map<string, any>();
  for (const x of docs) {
    if (Math.abs(x.open) < 0.005) continue;
    const r = by.get(x.customer) ?? { customer: x.customer, name: x.name, limit: x.credit_limit, terms: x.terms_days, open: 0, current: 0, b1: 0, b2: 0, b3: 0, b4: 0, unapplied: 0 };
    r.open += x.open;
    if (x.open < 0) r.unapplied += x.open;
    else { const late = Math.round((Date.parse(d) - Date.parse(x.due_date)) / 86400000); if (late <= 0) r.current += x.open; else r[late <= 30 ? "b1" : late <= 60 ? "b2" : late <= 90 ? "b3" : "b4"] += x.open; }
    by.set(x.customer, r);
  }
  const rows = [...by.values()].map((r) => ({ ...r, past: r.b1 + r.b2 + r.b3 + r.b4, util: r.limit ? r.open / r.limit : null })).sort((a, b) => b.past - a.past);
  const weeks = [];
  const ws = weekStartOf(s.asOf, s.cal);
  const pays = await sql<any[]>`
    select t.trans_date d, -sum(t.amount) v from si.ar_trans t left join si.customer c on c.company = t.company and c.account = t.customer
    where t.company = ${s.f.company} and t.doc_type in ('payment','advance') and t.trans_date between ${addDays(ws, -7 * 12)} and ${s.asOf} ${arWhere(s.f).frag} group by 1`;
  const sales = await dailySeries(s.f, { start: addDays(ws, -7 * 12), end: s.asOf });
  for (let i = 11; i >= 0; i--) {
    const st = addDays(ws, -7 * i), en = addDays(st, 6);
    weeks.push({ label: `${+st.slice(8)} ${MON[+st.slice(5, 7) - 1]}`, cur: r0(pays.filter((p) => p.d >= st && p.d <= en).reduce((a, p) => a + p.v, 0)), prev: r0(bucketSum(sales, { start: st, end: en }).net), href: siHref(s, "/si/ar", { asOf: en > s.asOf ? s.asOf : en, g: "week" }) });
  }
  const holds = (await backlogAsOf(s.f, d, true)).rows.filter((r: any) => r.hold);
  const unapplied = rows.filter((r) => r.unapplied < 0);
  const reversals = await sql<any[]>`select s.settle_id, s.settle_date, s.reversed_date, s.amount, d.customer, d.doc_id from si.settlement s join si.ar_trans d on d.company = s.company and d.trans_id = s.debit_trans where s.company = ${s.f.company} and s.reversed_date is not null and s.reversed_date <= ${d} order by s.reversed_date desc limit 50`;
  const v = (id: string) => (k.get(id)?.v as number) ?? 0;
  return { title: "Receivables, Collections & Credit Risk", layer: "COLLECTED (settlement date) · SNAPSHOT AS OF", blocks: [
    { t: "kpis", ids: ["AR-001", "AR-002", "AR-003", "AR-004", "AR-005", "AR-006", "AR-007", "AR-008", "AR-009", "AR-010", "AR-014", "AR-011"] },
    { t: "kpis", ids: ["AR-012", "AR-013", "ORD-015", "REV-004", "CUS-001", "FUL-003"] },
    { t: "trend", wide: true, title: "Weekly cash collected vs net sales · last 12 weeks", sub: "Collections include VAT; sales exclude it", curName: "Cash collected", prevName: "Net sales", data: weeks },
    { t: "waterfall", title: "AR aging ladder (as of)", sub: d, steps: [{ label: "Not due", value: v("AR-003") }, { label: "1–30", value: v("AR-004") }, { label: "31–60", value: v("AR-005") }, { label: "61–90", value: v("AR-006") }, { label: "90+", value: v("AR-007") }, { label: "Unapplied", value: rows.reduce((a, r) => a + r.unapplied, 0) }, { label: "Open AR", value: v("AR-001"), total: true }] },
    { t: "rank", title: "Credit limit utilisation (highest)", money: false, sub: "Open balance ÷ limit, %", rows: rows.filter((r) => r.util !== null).sort((a, b) => b.util - a.util).slice(0, 12).map((r) => ({ label: r.name ?? r.customer, value: Math.round(r.util * 100), href: siHref(s, "/si/customer", { c: r.customer }) })) },
    { t: "table", title: "Customer aging snapshot", sub: `As of ${d} · invoice accounts`, cols: [{ key: "name", label: "Customer", href: tpl(s, "/si/customer", { c: "{customer}" }) }, { key: "terms", label: "Terms", type: "int" }, { key: "limit", label: "Credit limit", type: "money" }, { key: "open", label: "Open", type: "money" }, { key: "current", label: "Not due", type: "money" },
      { key: "b1", label: "1–30", type: "money" }, { key: "b2", label: "31–60", type: "money" }, { key: "b3", label: "61–90", type: "money" }, { key: "b4", label: "90+", type: "money", tone: "badIfPositive" }, { key: "unapplied", label: "Unapplied", type: "money" }, { key: "util", label: "Utilisation", type: "pct" }], rows,
      total: { name: "Total", open: rows.reduce((a, r) => a + r.open, 0), current: rows.reduce((a, r) => a + r.current, 0), b1: rows.reduce((a, r) => a + r.b1, 0), b2: rows.reduce((a, r) => a + r.b2, 0), b3: rows.reduce((a, r) => a + r.b3, 0), b4: rows.reduce((a, r) => a + r.b4, 0), unapplied: rows.reduce((a, r) => a + r.unapplied, 0) } },
    { t: "table", title: "Orders on hold", cols: [{ key: "order_id", label: "Order" }, { key: "customer_name", label: "Customer" }, { key: "hold", label: "Hold type" }, { key: "open_value", label: "Open value", type: "money" }, { key: "created", label: "Created", type: "date" }, { key: "age", label: "Age (d)", type: "int" }], rows: holds, maxHeight: 300 },
    { t: "table", title: "Unapplied payments & settlement reversals", cols: [{ key: "name", label: "Customer" }, { key: "unapplied", label: "Unapplied credit", type: "money" }], rows: unapplied, maxHeight: 200 },
    { t: "table", title: "Reversed settlements", cols: [{ key: "settle_id", label: "Settlement" }, { key: "doc_id", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "settle_date", label: "Settled", type: "date" }, { key: "reversed_date", label: "Reversed", type: "date" }, { key: "amount", label: "Amount", type: "money" }], rows: reversals, maxHeight: 240 },
  ], footnote: "AR is rebuilt as of the selected date from transactions and settlements effective on that date (a reversed settlement reopens the invoice). Product and salesperson filters do not apply to receivables. DSO uses the count-back formula named on the KPI." };
}

// ------------------------------------------------------------------ 34 reconciliation & data quality
export async function reconScreen(s: SiScope): Promise<Screen> {
  const c = s.f.company;
  const checks: { area: string; check: string; expected: string; actual: string; diff: number; status: string }[] = [];
  const add = (area: string, check: string, expected: number, actual: number, tol = 0.01) => checks.push({ area, check, expected: expected.toLocaleString("en-US", { maximumFractionDigits: 2 }), actual: actual.toLocaleString("en-US", { maximumFractionDigits: 2 }), diff: actual - expected, status: Math.abs(actual - expected) <= tol ? "PASS" : "FAIL" });
  const [t] = await sql<any[]>`select coalesce(sum(net_mst),0) net from si.invoice_line where company = ${c}`;
  const [byD] = await sql<any[]>`select coalesce(sum(v),0) v from (select invoice_date, sum(net_mst) v from si.invoice_line where company = ${c} group by 1) x`;
  const [byM] = await sql<any[]>`select coalesce(sum(v),0) v from (select date_trunc('month', invoice_date), sum(net_mst) v from si.invoice_line where company = ${c} group by 1) x`;
  const [byQ] = await sql<any[]>`select coalesce(sum(v),0) v from (select date_trunc('quarter', invoice_date), sum(net_mst) v from si.invoice_line where company = ${c} group by 1) x`;
  add("Aggregation", "Σ daily net = total net (T06)", t.net, byD.v); add("Aggregation", "Σ monthly net = total net (T07)", t.net, byM.v); add("Aggregation", "Σ quarterly net = total net", t.net, byQ.v);
  const [dup] = await sql<any[]>`select count(*)::int n from (select invoice_line_key from si.invoice_line where company = ${c} group by 1 having count(*) > 1) x`;
  add("Keys", "Duplicate invoice line keys", 0, dup.n, 0);
  const [orph] = await sql<any[]>`select count(*)::int n from si.invoice_line il where company = ${c} and not exists (select 1 from si.customer x where x.company = il.company and x.account = il.customer)`;
  add("Keys", "Invoice lines with unknown customer", 0, orph.n, 0);
  const [orphI] = await sql<any[]>`select count(*)::int n from si.invoice_line il where company = ${c} and not exists (select 1 from si.product x where x.company = il.company and x.item = il.item)`;
  add("Keys", "Invoice lines with unknown item", 0, orphI.n, 0);
  const [vat] = await sql<any[]>`select count(*)::int n from si.invoice_line where company = ${c} and net_mst is not null and abs(net_mst) > 0 and tax <> 0 and abs(net + tax - (gross - discount + tax)) > 0.02`;
  add("Amounts", "Net = gross − discount (VAT kept outside net)", 0, vat.n, 0);
  const [fx] = await sql<any[]>`select count(*)::int n from si.invoice_line where company = ${c} and net_mst is null`;
  add("Currency", "Lines without accounting-currency amount (excluded from totals)", 0, fx.n, 0);
  const [bal] = await sql<any[]>`
    select count(*)::int n from si.order_line ol join (select order_id, line_no, sum(qty) q from si.slip_line where company = ${c} group by 1,2) s on s.order_id = ol.order_id and s.line_no = ol.line_no
    where ol.company = ${c} and s.q > ol.qty - ol.cancelled_qty + 0.0001`;
  add("Order-to-cash", "Order lines delivered beyond ordered − cancelled", 0, bal.n, 0);
  const [over] = await sql<any[]>`
    select count(*)::int n from (select order_id, order_line, sum(qty) q from si.invoice_line where company = ${c} and doc_type = 'invoice' and order_id is not null group by 1,2) i
      left join (select order_id, line_no, sum(qty) q from si.slip_line where company = ${c} group by 1,2) s on s.order_id = i.order_id and s.line_no = i.order_line
    where i.q > coalesce(s.q,0) + 0.0001 and exists (select 1 from si.slip_line x where x.company = ${c})`;
  add("Order-to-cash", "Order lines invoiced beyond delivered (revenue multiplication guard, T11)", 0, over.n, 0);
  const [canc] = await sql<any[]>`select count(*)::int n from si.invoice_line i join si.order_line o on o.company = i.company and o.order_id = i.order_id and o.line_no = i.order_line where i.company = ${c} and o.status = 'cancelled'`;
  add("Order-to-cash", "Invoices on fully cancelled lines", 0, canc.n, 0);
  const [ar1] = await sql<any[]>`select coalesce(sum(amount),0) v from si.ar_trans where company = ${c} and trans_date <= ${s.asOf}`;
  const ar = await arAsOf({ company: c, dims: {} }, s.asOf);
  add("Receivables", `AR as of ${s.asOf}: Σ transactions = Σ open items`, ar1.v, ar.open);
  const [st] = await sql<any[]>`select count(*)::int n from si.settlement x join si.ar_trans d on d.company = x.company and d.trans_id = x.debit_trans where x.company = ${c} and x.reversed_date is null group by d.trans_id, d.amount having sum(x.amount) > d.amount + 0.01`;
  add("Receivables", "Invoices settled above their amount", 0, st?.n ?? 0, 0);
  const tv = await sql<any[]>`select salesperson, month, count(*)::int n from si.target where company = ${c} and status = 'approved' group by 1,2 having count(*) > 1`;
  add("Targets", "Overlapping approved target versions", 0, tv.length, 0);
  if (s.co.mode === "DEMO") {
    const { generateDemo, seedReport } = await import("./demo");
    const r = seedReport(generateDemo());
    add("Source → model", "Demo generator net sales = loaded net sales", r.netSalesMst, t.net, 0.05);
  } else {
    const [src] = await sql<any[]>`select coalesce(sum(line_amount),0) v from d365.invoice_lines where company = ${c} and currency = ${s.co.currency}`;
    const [mod] = await sql<any[]>`select coalesce(sum(net_mst),0) v from si.invoice_line where company = ${c}`;
    add("Source → model", "D365 synced invoice lines (accounting currency) = model net sales", src.v, mod.v, 0.05);
  }
  const p = s.pc.comparison ? await pvm(s.f, s.pc.current, s.pc.comparison) : null;
  if (p) add("Bridge", "Price + volume + mix + new + lost + allowances + other = total change", p.change, p.change - p.residual);
  const fails = checks.filter((x) => x.status === "FAIL").length;
  return { title: "Reconciliation & Data Quality", layer: "CONTROL", showGrain: false, blocks: [
    { t: "note", tone: fails ? "warn" : "info", text: fails ? `${fails} check(s) failing. Values on dashboards are not certified until these pass.` : `All ${checks.length} checks pass for ${c.toUpperCase()} (tolerance 0.01 in the accounting currency; counts must be exactly zero).` },
    { t: "table", title: "Control checks", cols: [{ key: "area", label: "Area" }, { key: "check", label: "Check", wrap: true }, { key: "expected", label: "Expected" }, { key: "actual", label: "Actual" }, { key: "diff", label: "Difference", type: "num", tone: "badIfPositive" }, { key: "status", label: "Result" }], rows: checks },
  ] };
}

// ------------------------------------------------------------------ dictionary, report library, health
export function kpiScreen(s: SiScope, k: K): Screen {
  const focus = s.q.k;
  const rows = CATALOG.map((x) => ({ ...x, value: k.get(x.id) ? fmtValue(k.get(x.id)!, s.co.currency) : "", vnote: k.get(x.id)?.note ?? x.note ?? "" }))
    .sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));
  const count = (st: string) => CATALOG.filter((x) => x.status === st).length;
  return { title: "Metric Dictionary (180 KPIs)", layer: "REGISTRY", showGrain: true, blocks: [
    { t: "note", text: `Version sales-kpi-v1.0 · ${count("IMPLEMENTED")} implemented · ${count("DEMO ONLY")} demo only · ${count("BLOCKED BY SOURCE")} blocked by source · ${count("NOT BUILT")} not built. Values below are live for the current filters.${focus ? ` Showing ${focus} first.` : ""}` },
    { t: "table", title: "KPI registry", maxHeight: 900, cols: [{ key: "id", label: "ID" }, { key: "domainName", label: "Domain" }, { key: "name", label: "Metric" }, { key: "ar", label: "Arabic" }, { key: "value", label: "Current value" }, { key: "status", label: "Status" },
      { key: "definition", label: "Definition / policy", wrap: true }, { key: "layer", label: "Layer" }, { key: "dateRole", label: "Date role" }, { key: "aggregation", label: "Aggregation" }, { key: "unit", label: "Unit" }, { key: "vnote", label: "Notes", wrap: true }], rows },
  ] };
}
function fmtValue(v: KpiValue, cur: string) {
  if (v.v === null) return "N/A";
  if (typeof v.v === "string") return v.v;
  return v.unit === "money" ? `${cur} ${Math.round(v.v).toLocaleString("en-US")}` : v.unit === "pct" ? `${(v.v * 100).toFixed(1)}%` : v.unit === "days" ? `${v.v.toFixed(1)} days` : v.unit === "pts" ? `${v.v.toFixed(1)} pts` : v.v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
export function reportsScreen(s: SiScope): Screen {
  const rows = REPORTS.map((r) => ({ ...r, open: r.route ? siHref(s, r.route) : "" }));
  const count = (st: string) => REPORTS.filter((x) => x.status === st).length;
  const kGaps = CATALOG.filter((x) => x.status !== "IMPLEMENTED").map((x) => ({ id: x.id, name: x.name, status: x.status, why: x.note ?? (x.status === "NOT BUILT" ? "Planned; not implemented in this release" : "") }));
  return { title: "Report Library & Gap Log", layer: "REGISTRY", showGrain: false, blocks: [
    { t: "note", text: `170 report definitions from one semantic model: ${count("IMPLEMENTED")} implemented (open them from the table), ${count("DEMO ONLY")} demo only, ${count("BLOCKED BY SOURCE")} blocked by source, ${count("NOT BUILT")} not built. No report is shown as available when it is not.` },
    { t: "table", title: "Reports", maxHeight: 700, cols: [{ key: "id", label: "ID" }, { key: "domainName", label: "Domain" }, { key: "name", label: "Report", href: "@open" }, { key: "question", label: "Questions / measures", wrap: true }, { key: "grain", label: "Grain" }, { key: "status", label: "Status" }, { key: "route", label: "Screen" }], rows },
    { t: "table", title: "KPI gap log", maxHeight: 500, cols: [{ key: "id", label: "ID" }, { key: "name", label: "Metric" }, { key: "status", label: "Status" }, { key: "why", label: "Reason / dependency", wrap: true }], rows: kGaps },
  ] };
}
export async function healthScreen(s: SiScope): Promise<Screen> {
  const rows = await sql<any[]>`select entity, status, rows, last_success, watermark, latency_min, message from si.sync_health where company = ${s.f.company} order by entity`;
  const audit = await sql<any[]>`select a.at, a.action, a.target, u.name, a.detail::text detail from si.audit a left join portal.users u on u.id = a.user_id order by a.at desc limit 50`;
  const d365 = await sql<any[]>`select c.company, c.name, (select max(finished_at) from d365.sync_runs r where r.company = c.company and r.status = 'ok') last_sync,
      (select count(*) from d365.invoice_lines l where l.company = c.company)::int lines, (select mode from si.company x where x.company = c.company) si_mode
    from d365.companies c ${s.user.role === "admin" ? sql`` : sql`where c.company in ${sql(s.user.companies.length ? s.user.companies : ["__none__"])}`} order by 1`;
  return { title: "Connection Health & Setup", layer: "CONTROL", showGrain: false, blocks: [
    { t: "note", text: `Mode for ${s.co.company.toUpperCase()}: ${s.co.mode === "DEMO" ? "DEMO" : "CONNECTED_D365"}. Sales Intelligence only reads; it never writes to D365. ${s.co.mode === "DEMO" ? "Demo rows are generated, not extracted." : "Rows are projected from the portal's D365 sync (Administration › Data sync)."}` },
    { t: "table", title: `Entities for ${s.co.company.toUpperCase()}`, cols: [{ key: "entity", label: "Entity" }, { key: "status", label: "Status" }, { key: "rows", label: "Rows", type: "int" }, { key: "last_success", label: "Last load" }, { key: "watermark", label: "Watermark" }, { key: "latency_min", label: "Lag (min)", type: "int" }, { key: "message", label: "Notes", wrap: true }], rows: rows.map((r) => ({ ...r, last_success: r.last_success ? new Date(r.last_success).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "–" })) },
    { t: "table", title: "D365 companies available to project", cols: [{ key: "company", label: "Company" }, { key: "name", label: "Name" }, { key: "lines", label: "Synced invoice lines", type: "int" }, { key: "last_sync", label: "Last D365 sync" }, { key: "si_mode", label: "In Sales Intelligence" }], rows: d365.map((r) => ({ ...r, last_sync: r.last_sync ? new Date(r.last_sync).toISOString().slice(0, 16).replace("T", " ") : "never", si_mode: r.si_mode ?? "not projected" })) },
    { t: "table", title: "Audit trail", cols: [{ key: "at", label: "When" }, { key: "action", label: "Action" }, { key: "target", label: "Target" }, { key: "name", label: "User" }, { key: "detail", label: "Detail", wrap: true }], rows: audit.map((a) => ({ ...a, at: new Date(a.at).toISOString().slice(0, 16).replace("T", " "), name: a.name ?? "system" })), maxHeight: 320 },
  ] };
}
