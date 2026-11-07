"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export interface FilterProps {
  company: string; companies: { company: string; name: string }[];
  from: string; to: string; years: number[];
  currency: string; currencies: string[]; group: string | null; groups: string[];
  show?: { period?: boolean; currency?: boolean; group?: boolean };
  extra?: React.ReactNode;
}

export default function FilterBar(p: FilterProps) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const show = { period: true, currency: true, group: true, ...p.show };

  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    q.set("company", p.company); q.set("from", p.from); q.set("to", p.to); q.set("currency", p.currency);
    for (const [k, v] of Object.entries(patch)) (v ? q.set(k, v) : q.delete(k));
    if (patch.company) q.delete("currency");
    start(() => router.push(`${path}?${q.toString()}`));
  };

  return (
    <div className={`card flex flex-wrap items-end gap-x-4 gap-y-3 px-3.5 py-3 transition-opacity ${pending ? "opacity-60" : ""}`}>
      <div className="grid gap-1">
        <label htmlFor="f-company" className="label">Company</label>
        <select id="f-company" className="input" value={p.company} onChange={(e) => set({ company: e.target.value })}>
          {p.companies.map((c) => <option key={c.company} value={c.company}>{c.company.toUpperCase()} · {c.name}</option>)}
        </select>
      </div>
      {show.period && (
        <>
          <div className="grid gap-1">
            <label htmlFor="f-from" className="label">From</label>
            <input id="f-from" type="date" className="input" value={p.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <label htmlFor="f-to" className="label">To</label>
            <input id="f-to" type="date" className="input" value={p.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </div>
          {p.years.length > 0 && (
            <div className="grid gap-1">
              <span className="label">Year</span>
              <div className="flex flex-wrap gap-1">
                {p.years.map((y) => {
                  const on = p.from === `${y}-01-01` && p.to === `${y}-12-31`;
                  return (
                    <button key={y} type="button" aria-pressed={on} onClick={() => set({ from: `${y}-01-01`, to: `${y}-12-31` })}
                      className={`btn !px-2.5 ${on ? "btn-primary" : ""}`}>{y}</button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
      {show.currency && p.currencies.length > 1 && (
        <div className="grid gap-1">
          <label htmlFor="f-cur" className="label">Currency</label>
          <select id="f-cur" className="input" value={p.currency} onChange={(e) => set({ currency: e.target.value })}>
            {p.currencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      )}
      {show.group && p.groups.length > 0 && (
        <div className="grid gap-1">
          <label htmlFor="f-group" className="label">Customer group</label>
          <select id="f-group" className="input" value={p.group ?? ""} onChange={(e) => set({ group: e.target.value || null })}>
            <option value="">All groups</option>
            {p.groups.map((g) => <option key={g}>{g}</option>)}
          </select>
        </div>
      )}
      {p.extra}
    </div>
  );
}
