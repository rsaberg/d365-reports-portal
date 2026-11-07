export const fmt = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = (n: number, cur?: string) => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : fmt(n);
  return cur ? `${cur} ${s}` : s;
};
export const pctFmt = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
export const dateFmt = (d: string | Date | null) => {
  if (!d) return "–";
  const s = typeof d === "string" ? d : d.toISOString();
  return new Date(s.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
