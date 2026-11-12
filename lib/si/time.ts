/**
 * Sales Intelligence time engine (spec §5).
 * Pure functions over ISO dates ('YYYY-MM-DD', business-local date of the legal entity).
 * No time zone math happens here: facts already carry the legal entity's local business date.
 */
export type Grain = "day" | "week" | "month" | "quarter" | "year";
export type Compare = "prev" | "ly" | "none";
export type Basis = "calendar" | "trading";

export interface CompanyCalendar {
  /** 1–12; month the fiscal year starts. FY is named after the calendar year it ends in. */
  fiscalStartMonth: number;
  /** 0=Sun … 6=Sat; first day of the business week. */
  weekStart: number;
  /** Non-trading weekdays, e.g. [5, 6] for Fri/Sat. */
  weekend: number[];
  /** Holidays (non-trading dates). */
  holidays?: string[];
}

export const DEFAULT_CALENDAR: CompanyCalendar = { fiscalStartMonth: 1, weekStart: 6, weekend: [5], holidays: [] };

const DAY = 86400000;
export const toTime = (d: string) => Date.parse(d + "T00:00:00Z");
export const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY); // b - a
export const weekday = (d: string) => new Date(toTime(d)).getUTCDay();
const ymd = (d: string) => [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))] as const;
const iso = (y: number, m: number, day: number) => `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Add months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: string, n: number) {
  const [y, m, day] = ymd(d);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return iso(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}
/** Same date last year; 29 Feb maps to 28 Feb (policy shown in the UI). */
export const addYears = (d: string, n: number) => addMonths(d, 12 * n);

export function isTradingDay(d: string, cal: CompanyCalendar) {
  return !cal.weekend.includes(weekday(d)) && !(cal.holidays ?? []).includes(d);
}
export function tradingDays(from: string, to: string, cal: CompanyCalendar) {
  let n = 0;
  for (let t = toTime(from); t <= toTime(to); t += DAY) if (isTradingDay(toISO(t), cal)) n++;
  return n;
}

export interface FiscalInfo { fy: number; fq: number; fm: number; fyStart: string; fyEnd: string; fqStart: string; fqEnd: string; monthStart: string; monthEnd: string }

export function fiscal(d: string, cal: CompanyCalendar): FiscalInfo {
  const [y, m] = ymd(d);
  const s = cal.fiscalStartMonth;
  const fm = ((m - s + 12) % 12) + 1; // fiscal month number 1..12
  const startYear = m >= s ? y : y - 1;
  const fyStart = iso(startYear, s, 1);
  const fyEnd = addDays(addMonths(fyStart, 12), -1);
  const fy = s === 1 ? startYear : startYear + 1;
  const fq = Math.ceil(fm / 3);
  const fqStart = addMonths(fyStart, (fq - 1) * 3);
  const fqEnd = addDays(addMonths(fqStart, 3), -1);
  const monthStart = iso(y, m, 1);
  const monthEnd = iso(y, m, daysInMonth(y, m));
  return { fy, fq, fm, fyStart, fyEnd, fqStart, fqEnd, monthStart, monthEnd };
}

export function weekStartOf(d: string, cal: CompanyCalendar) {
  return addDays(d, -((weekday(d) - cal.weekStart + 7) % 7));
}

/** Full period containing d. */
export function periodOf(grain: Grain, d: string, cal: CompanyCalendar): { start: string; end: string } {
  const f = fiscal(d, cal);
  switch (grain) {
    case "day": return { start: d, end: d };
    case "week": { const s = weekStartOf(d, cal); return { start: s, end: addDays(s, 6) }; }
    case "month": return { start: f.monthStart, end: f.monthEnd };
    case "quarter": return { start: f.fqStart, end: f.fqEnd };
    case "year": return { start: f.fyStart, end: f.fyEnd };
  }
}

export function shiftPeriodStart(grain: Grain, start: string, n: number) {
  switch (grain) {
    case "day": return addDays(start, n);
    case "week": return addDays(start, 7 * n);
    case "month": return addMonths(start, n);
    case "quarter": return addMonths(start, 3 * n);
    case "year": return addMonths(start, 12 * n);
  }
}

export interface Range { start: string; end: string }
export interface PeriodContext {
  grain: Grain; asOf: string;
  /** Selected period to date (MTD/QTD/YTD …). */
  current: Range;
  /** Full selected period (for "OPEN PERIOD" badge and run-rate). */
  full: Range;
  isPartial: boolean;
  compare: Compare; basis: Basis;
  /** Comparable range: same elapsed position in the comparison period. */
  comparison: Range | null;
  comparisonFull: Range | null;
  label: string; comparisonLabel: string | null;
  elapsedDays: number; elapsedTradingDays: number; totalTradingDays: number;
}

/**
 * Comparable end inside a prior period: same number of elapsed calendar days, or the same number of
 * elapsed trading days (spec §5.2), clipped to that period's end.
 */
function comparableEnd(prior: Range, current: Range, basis: Basis, cal: CompanyCalendar) {
  if (basis === "calendar") {
    const e = addDays(prior.start, daysBetween(current.start, current.end));
    return e > prior.end ? prior.end : e;
  }
  const target = tradingDays(current.start, current.end, cal);
  if (target === 0) return prior.start;
  let n = 0;
  for (let t = toTime(prior.start); t <= toTime(prior.end); t += DAY) {
    if (isTradingDay(toISO(t), cal)) n++;
    if (n === target) return toISO(t);
  }
  return prior.end;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function rangeLabel(grain: Grain, r: Range, cal: CompanyCalendar, toDate = false) {
  const f = fiscal(r.start, cal);
  const [y, m, d] = ymd(r.start);
  switch (grain) {
    case "day": return `${d} ${MONTHS[m - 1]} ${y}`;
    case "week": return `Week of ${d} ${MONTHS[m - 1]} ${y}${toDate ? " (WTD)" : ""}`;
    case "month": return `${MONTHS[m - 1]} ${y}${toDate ? " MTD" : ""}`;
    case "quarter": return `FY${f.fy} Q${f.fq}${toDate ? " QTD" : ""}`;
    case "year": return `FY${f.fy}${toDate ? " YTD" : ""}`;
  }
}

export function periodContext(grain: Grain, asOf: string, cal: CompanyCalendar, compare: Compare = "ly", basis: Basis = "calendar", toDate = true): PeriodContext {
  const full = periodOf(grain, asOf, cal);
  const current = { start: full.start, end: toDate ? asOf : full.end };
  const isPartial = current.end < full.end;
  let comparison: Range | null = null, comparisonFull: Range | null = null;
  if (compare !== "none") {
    let pStart: string, pEnd: string;
    if (compare === "prev") { pStart = shiftPeriodStart(grain, full.start, -1); pEnd = addDays(full.start, -1); }
    else {
      // Same period last year. Weeks: same week position one year earlier (52 weeks back keeps weekday alignment).
      if (grain === "week") { pStart = addDays(full.start, -364); pEnd = addDays(pStart, 6); }
      else if (grain === "day") { pStart = addDays(full.start, -364); pEnd = pStart; } // same weekday last year
      else { pStart = addYears(full.start, -1); pEnd = periodOf(grain, pStart, cal).end; }
    }
    comparisonFull = { start: pStart, end: pEnd };
    comparison = { start: pStart, end: isPartial ? comparableEnd(comparisonFull, current, basis, cal) : pEnd };
  }
  return {
    grain, asOf, current, full, isPartial, compare, basis, comparison, comparisonFull,
    label: rangeLabel(grain, current, cal, isPartial),
    comparisonLabel: comparison ? rangeLabel(grain, comparison, cal, isPartial) : null,
    elapsedDays: daysBetween(current.start, current.end) + 1,
    elapsedTradingDays: tradingDays(current.start, current.end, cal),
    totalTradingDays: tradingDays(full.start, full.end, cal),
  };
}

/** Buckets used by the trend chart for each grain (spec §5.1 visual column). */
export function trendBuckets(grain: Grain, asOf: string, cal: CompanyCalendar): { bucket: "day" | "week" | "month"; ranges: (Range & { key: string; label: string })[] } {
  const out: (Range & { key: string; label: string })[] = [];
  if (grain === "day") {
    for (let i = 29; i >= 0; i--) { const d = addDays(asOf, -i); out.push({ start: d, end: d, key: d, label: `${ymd(d)[2]} ${MONTHS[ymd(d)[1] - 1]}` }); }
    return { bucket: "day", ranges: out };
  }
  if (grain === "week") {
    const ws = weekStartOf(asOf, cal);
    for (let i = 12; i >= 0; i--) { const s = addDays(ws, -7 * i); out.push({ start: s, end: addDays(s, 6), key: s, label: `${ymd(s)[2]} ${MONTHS[ymd(s)[1] - 1]}` }); }
    return { bucket: "week", ranges: out };
  }
  if (grain === "month") {
    const p = periodOf("month", asOf, cal);
    for (let t = toTime(p.start); t <= toTime(p.end); t += DAY) { const d = toISO(t); out.push({ start: d, end: d, key: d, label: String(ymd(d)[2]) }); }
    return { bucket: "day", ranges: out };
  }
  if (grain === "quarter") {
    const p = periodOf("quarter", asOf, cal);
    const ws = weekStartOf(p.start, cal);
    for (let s = ws; s <= p.end; s = addDays(s, 7)) out.push({ start: s < p.start ? p.start : s, end: addDays(s, 6) > p.end ? p.end : addDays(s, 6), key: s, label: `${ymd(s)[2]} ${MONTHS[ymd(s)[1] - 1]}` });
    return { bucket: "week", ranges: out };
  }
  const p = periodOf("year", asOf, cal);
  for (let i = 0; i < 12; i++) { const s = addMonths(p.start, i); out.push({ start: s, end: addDays(addMonths(s, 1), -1), key: s.slice(0, 7), label: `${MONTHS[ymd(s)[1] - 1]} ${String(ymd(s)[0]).slice(2)}` }); }
  return { bucket: "month", ranges: out };
}

/** Growth % with the spec's zero-denominator policy (null = N/A). */
export const growth = (cur: number, prior: number | null | undefined) => (prior === null || prior === undefined || prior === 0 ? null : (cur - prior) / Math.abs(prior));
export const safeDiv = (a: number, b: number) => (b === 0 ? null : a / b);
