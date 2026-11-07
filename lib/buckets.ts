/** Ship-date buckets: days late relative to the as-of date (negative = due in the future). */
export const SHIP_BUCKETS = [
  { label: "> 30 days late", test: (d: number) => d > 30, color: "var(--c2)" },
  { label: "8–30 days late", test: (d: number) => d > 7 && d <= 30, color: "var(--c2)" },
  { label: "1–7 days late", test: (d: number) => d > 0 && d <= 7, color: "var(--c4)" },
  { label: "Due this week", test: (d: number) => d <= 0 && d > -7, color: "var(--c1)" },
  { label: "Next week", test: (d: number) => d <= -7 && d > -14, color: "var(--c1)" },
  { label: "Later", test: (d: number) => d <= -14, color: "var(--cprev)" },
];

export async function agingSettings() {
  const { sql } = await import("./db");
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from portal.settings where key in ('aging_buckets','aging_basis')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const limits = Array.isArray(m.aging_buckets) ? (m.aging_buckets as number[]) : [30, 60, 90, 120, 150, 180, 270, 365];
  return { limits, basis: (m.aging_basis === "trans" ? "trans" : "due") as "due" | "trans" };
}

export function agingBuckets(limits: number[]) {
  const defs: { label: string; lo: number; hi: number }[] = [{ label: "Not due", lo: -Infinity, hi: 0 }];
  let prev = 0;
  for (const l of limits) { defs.push({ label: `${prev + 1}–${l}`, lo: prev + 1, hi: l }); prev = l; }
  defs.push({ label: `> ${prev}`, lo: prev + 1, hi: Infinity });
  return defs;
}
export const bucketIndex = (days: number, defs: { hi: number }[]) => { const i = defs.findIndex((d) => days <= d.hi); return i < 0 ? defs.length - 1 : i; };
