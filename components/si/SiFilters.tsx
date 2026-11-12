"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface SiFilterProps {
  companies: { company: string; name: string; mode: string }[];
  company: string; asOf: string; grain: string; compare: string; basis: string; full: boolean; showGrain: boolean;
  options: Record<string, { v: string; l: string }[]>;
  active: Record<string, string[]>;
  labels: Record<string, string>;
  pinnedRep: boolean;
}
const GRAINS: [string, string][] = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Yearly"]];

/** Global SI filter bar: company, time grain, as-of, comparison and basis, plus dimension filters shown as removable chips.
 *  All state lives in the URL, so back/forward, drill-through and sharing keep the same context. */
export default function SiFilters(p: SiFilterProps) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const go = (over: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(over)) { if (v === null || v === "") q.delete(k); else q.set(k, v); }
    router.push(`${path}?${q.toString()}`);
  };
  const dims = Object.keys(p.options).filter((d) => !(d === "salesperson" && p.pinnedRep) && p.options[d].length);
  const chips = Object.entries(p.active).flatMap(([d, vs]) => vs.map((v) => ({ d, v, l: p.options[d]?.find((o) => o.v === v)?.l ?? v })));
  return (
    <div className="grid gap-2 mb-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1"><span className="label">Legal entity</span>
          <select className="input" value={p.company} onChange={(e) => go({ company: e.target.value, asOf: null, ...Object.fromEntries(dims.map((d) => [d, null])), customer: null, item: null, c: null })}>
            {p.companies.map((c) => <option key={c.company} value={c.company}>{c.company.toUpperCase()} · {c.name}{c.mode === "DEMO" ? "" : " (D365)"}</option>)}
          </select>
        </label>
        {p.showGrain && (
          <div className="grid gap-1"><span className="label">Time grain</span>
            <div className="inline-flex rounded-md border border-line overflow-hidden" role="tablist">
              {GRAINS.map(([g, l]) => (
                <button key={g} type="button" role="tab" aria-selected={p.grain === g} onClick={() => go({ g })}
                  className={`px-2.5 py-[7px] text-[12.5px] ${p.grain === g ? "bg-[#0D2445] text-white font-medium" : "bg-surface text-muted hover:text-ink"}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <label className="grid gap-1"><span className="label">As of</span>
          <input type="date" className="input" value={p.asOf} onChange={(e) => e.target.value && go({ asOf: e.target.value })} />
        </label>
        <label className="grid gap-1"><span className="label">Period</span>
          <select className="input" value={p.full ? "1" : ""} onChange={(e) => go({ full: e.target.value || null })}>
            <option value="">To date (MTD / QTD / YTD)</option><option value="1">Full period</option>
          </select>
        </label>
        <label className="grid gap-1"><span className="label">Compare with</span>
          <select className="input" value={p.compare} onChange={(e) => go({ cmp: e.target.value })}>
            <option value="ly">Same period last year</option><option value="prev">Previous period</option><option value="none">No comparison</option>
          </select>
        </label>
        <label className="grid gap-1"><span className="label">Comparable days</span>
          <select className="input" value={p.basis} onChange={(e) => go({ basis: e.target.value === "trading" ? "trading" : null })}>
            <option value="calendar">Calendar days</option><option value="trading">Trading days</option>
          </select>
        </label>
        <details className="relative">
          <summary className="btn cursor-pointer list-none">+ Filter</summary>
          <div className="absolute z-30 mt-1 w-[280px] card p-3 grid gap-2 shadow-xl">
            {dims.map((d) => (
              <label key={d} className="grid gap-1"><span className="label">{p.labels[d] ?? d}</span>
                <select className="input" value="" onChange={(e) => { const cur = p.active[d] ?? []; if (e.target.value && !cur.includes(e.target.value)) go({ [d]: [...cur, e.target.value].join(",") }); }}>
                  <option value="">Add…</option>
                  {p.options[d].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      </div>
      {(chips.length > 0 || p.pinnedRep) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {p.pinnedRep && <span className="px-2.5 py-1 rounded-full bg-sunken text-muted">Your sales only</span>}
          {chips.map((c) => (
            <button key={c.d + c.v} type="button" onClick={() => { const rest = (p.active[c.d] ?? []).filter((x) => x !== c.v); go({ [c.d]: rest.length ? rest.join(",") : null }); }}
              className="px-2.5 py-1 rounded-full border border-ink/30 bg-surface hover:border-bad" title="Remove filter">
              <span className="text-muted">{p.labels[c.d] ?? c.d}:</span> {c.l} <span aria-hidden="true">×</span>
            </button>
          ))}
          {chips.length > 0 && <button type="button" className="text-accent hover:underline ms-1" onClick={() => go(Object.fromEntries(Object.keys(p.active).map((d) => [d, null])))}>Reset all</button>}
        </div>
      )}
    </div>
  );
}
