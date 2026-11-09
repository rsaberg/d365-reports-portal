"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export interface FinFilterProps {
  company: string; companies: { company: string; name: string }[];
  currency: string; currencies: string[];
  fromM: string; toM: string; years: number[];
  compare: string; compares?: { v: string; label: string }[];
  dims: string[]; dim: string | null; dimValue: string | null; dimValues: string[];
  view?: string; views?: { v: string; label: string }[]; by?: string | null;
  show?: { period?: boolean; from?: boolean; compare?: boolean; dim?: boolean };
}

const DEFAULT_COMPARES = [
  { v: "py", label: "Same period last year" }, { v: "pp", label: "Previous period" }, { v: "ye", label: "Last financial year" },
  { v: "budget", label: "Budget" }, { v: "none", label: "No comparison" },
];
const nice = (d: string) => d.charAt(0) + d.slice(1).toLowerCase().replace(/_/g, " ");

export default function FinFilters(p: FinFilterProps) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const show = { period: true, from: true, compare: true, dim: true, ...p.show };

  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    q.set("company", p.company); q.set("currency", p.currency); q.set("from", p.fromM); q.set("to", p.toM); q.set("compare", p.compare);
    for (const [k, v] of Object.entries(patch)) (v ? q.set(k, v) : q.delete(k));
    if (patch.company) q.delete("currency");
    if ("dim" in patch) q.delete("dv");
    q.delete("page");
    start(() => router.push(`${path}?${q.toString()}`));
  };

  return (
    <div className={`card flex flex-wrap items-end gap-x-4 gap-y-3 px-3.5 py-3 mb-4 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="grid gap-1">
        <label htmlFor="ff-co" className="label">Company</label>
        <select id="ff-co" className="input" value={p.company} onChange={(e) => set({ company: e.target.value })}>
          {p.companies.length > 1 && <option value="all">All companies (consolidated)</option>}
          {p.companies.map((c) => <option key={c.company} value={c.company}>{c.company.toUpperCase()} · {c.name}</option>)}
        </select>
      </div>
      {p.currencies.length > 1 && (
        <div className="grid gap-1">
          <label htmlFor="ff-cur" className="label">Currency</label>
          <select id="ff-cur" className="input" value={p.currency} onChange={(e) => set({ currency: e.target.value })}>
            {p.currencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      )}
      {show.period && (
        <>
          {show.from && (
            <div className="grid gap-1">
              <label htmlFor="ff-from" className="label">From</label>
              <input id="ff-from" type="month" className="input" value={p.fromM} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
          )}
          <div className="grid gap-1">
            <label htmlFor="ff-to" className="label">{show.from ? "To" : "As of"}</label>
            <input id="ff-to" type="month" className="input" value={p.toM} onChange={(e) => e.target.value && set({ to: e.target.value, ...(e.target.value < p.fromM ? { from: e.target.value.slice(0, 4) + "-01" } : {}) })} />
          </div>
          {p.years.length > 0 && (
            <div className="grid gap-1">
              <span className="label">Year</span>
              <div className="flex flex-wrap gap-1">
                {p.years.slice(-6).map((y) => {
                  const on = p.fromM === `${y}-01` && p.toM === `${y}-12`;
                  return <button key={y} type="button" aria-pressed={on} onClick={() => set({ from: `${y}-01`, to: `${y}-12` })} className={`btn !px-2.5 ${on ? "btn-primary" : ""}`}>{y}</button>;
                })}
              </div>
            </div>
          )}
        </>
      )}
      {show.compare && (
        <div className="grid gap-1">
          <label htmlFor="ff-cmp" className="label">Compare with</label>
          <select id="ff-cmp" className="input" value={p.compare} onChange={(e) => set({ compare: e.target.value })}>
            {(p.compares ?? DEFAULT_COMPARES).map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
      )}
      {p.views && (
        <div className="grid gap-1">
          <span className="label">View</span>
          <div className="flex flex-wrap gap-1">
            {p.views.map((v) => <button key={v.v} type="button" aria-pressed={p.view === v.v} onClick={() => set({ view: v.v })} className={`btn !px-2.5 ${p.view === v.v ? "btn-primary" : ""}`}>{v.label}</button>)}
          </div>
        </div>
      )}
      {p.view === "dim" && p.dims.length > 0 && (
        <div className="grid gap-1">
          <label htmlFor="ff-by" className="label">Columns by</label>
          <select id="ff-by" className="input" value={p.by ?? ""} onChange={(e) => set({ by: e.target.value })}>
            {p.dims.map((d) => <option key={d} value={d}>{nice(d)}</option>)}
          </select>
        </div>
      )}
      {show.dim && p.dims.length > 0 && (
        <div className="grid gap-1">
          <label htmlFor="ff-dim" className="label">Filter by dimension</label>
          <div className="flex gap-1">
            <select id="ff-dim" className="input" value={p.dim ?? ""} onChange={(e) => set({ dim: e.target.value || null })}>
              <option value="">No filter</option>
              {p.dims.map((d) => <option key={d} value={d}>{nice(d)}</option>)}
            </select>
            {p.dim && (
              <>
                <input aria-label="Dimension value" className="input w-40" list="ff-dvs" defaultValue={p.dimValue ?? ""} placeholder="Value"
                  onKeyDown={(e) => { if (e.key === "Enter") set({ dv: (e.target as HTMLInputElement).value || null }); }}
                  onBlur={(e) => { if (e.target.value !== (p.dimValue ?? "")) set({ dv: e.target.value || null }); }} />
                <datalist id="ff-dvs">{p.dimValues.map((v) => <option key={v} value={v} />)}</datalist>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
