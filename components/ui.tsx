import Link from "next/link";
import FilterBar, { FilterProps } from "./FilterBar";
import type { Scope } from "@/lib/filters";

export function filterProps(s: Scope): FilterProps {
  return { company: s.company, companies: s.companies, from: s.from, to: s.to, years: s.years, currency: s.currency,
    currencies: s.currencies, group: s.group, groups: s.groups };
}

export function PageHead({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight [text-wrap:balance]">{title}</h1>
        {sub && <p className="text-muted text-[13px] mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Filters({ s, show, extra }: { s: Scope; show?: FilterProps["show"]; extra?: React.ReactNode }) {
  return (
    <div className="mb-4 grid gap-2">
      <FilterBar {...filterProps(s)} show={show} extra={extra} />
      {s.otherCurrencyLines > 0 && (show?.currency ?? true) && (
        <p className="text-[12px] text-muted">
          Showing {s.currency} only. {s.otherCurrencyLines.toLocaleString()} invoice lines in other currencies are excluded; switch currency to see them.
        </p>
      )}
      {s.responsible && <p className="text-[12px] text-muted">You see the sales you are responsible for.</p>}
    </div>
  );
}

export type Tone = "good" | "bad" | "warn" | null;
export function Kpi({ label, value, note, tone = null, href }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className="bg-surface px-4 py-3 h-full grid content-start gap-0.5">
      <span className="label">{label}</span>
      <span className="num text-[21px] font-semibold tracking-tight">{value}</span>
      {note && <span className={`text-[12px] ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-muted"}`}>{note}</span>}
    </div>
  );
  return href ? <Link href={href} className="block hover:brightness-[.98]">{body}</Link> : body;
}
export function KpiRow({ children }: { children: React.ReactNode }) {
  return <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-line border border-line rounded-lg overflow-hidden mb-4">{children}</section>;
}

export function Panel({ title, sub, children, className = "", action }: { title: string; sub?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`card p-4 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold text-[14px]">{title}</h2>
        {sub && <span className="text-[12px] text-muted">{sub}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-muted text-[13px] py-8 text-center">{children}</div>;
}

export function Pill({ tone, children }: { tone: "good" | "bad" | "warn" | "neutral"; children: React.ReactNode }) {
  const c = tone === "good" ? "text-good bg-good/10" : tone === "bad" ? "text-bad bg-bad/10" : tone === "warn" ? "text-warn bg-warn/10" : "text-muted bg-sunken";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${c}`}>{children}</span>;
}

export function Tabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-1 mb-3" role="tablist">
      {items.map((t) => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={t.key === active}
          className={`btn !py-1 !min-h-0 ${t.key === active ? "btn-primary" : ""}`}>{t.label}</Link>
      ))}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-warn/40 bg-warn/5 px-3.5 py-2.5 text-[13px] mb-4">{children}</div>;
}
