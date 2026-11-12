import Link from "next/link";
import { Suspense } from "react";
import DataTable, { type Col } from "@/components/DataTable";
import { Donut } from "@/components/charts";
import { TrendChart, Waterfall, RankList, Heatmap, LayerFunnel, Pareto, type TrendRow, type Step } from "./charts";
import SiFilters from "./SiFilters";
import { kpi } from "@/lib/si/catalog";
import type { KpiValue } from "@/lib/si/metrics";
import { siHref, dimLabel, type SiScope } from "@/lib/si/scope";
import { SI_NAV } from "@/lib/si/nav";

export type Block =
  | { t: "kpis"; ids: string[]; title?: string }
  | { t: "trend"; title: string; sub?: string; data: TrendRow[]; curName: string; prevName?: string; cumulative?: boolean; wide?: boolean }
  | { t: "waterfall"; title: string; sub?: string; steps: Step[]; wide?: boolean }
  | { t: "rank"; title: string; sub?: string; rows: { label: string; value: number; prev?: number | null; sub?: string; href?: string }[]; money?: boolean; wide?: boolean }
  | { t: "heat"; title: string; sub?: string; weeks: Parameters<typeof Heatmap>[0]["weeks"]; days: string[]; wide?: boolean }
  | { t: "funnel"; title: string; sub?: string; steps: { label: string; value: number; note: string; href?: string }[]; wide?: boolean }
  | { t: "pareto"; title: string; sub?: string; rows: { label: string; value: number; href?: string }[]; wide?: boolean }
  | { t: "donut"; title: string; sub?: string; data: { label: string; value: number }[]; center: string; centerLabel: string; wide?: boolean }
  | { t: "table"; title: string; sub?: string; cols: Col[]; rows: Record<string, any>[]; total?: Record<string, any>; wide?: boolean; maxHeight?: number }
  | { t: "note"; text: React.ReactNode; tone?: "warn" | "info" }
  | { t: "html"; title: string; sub?: string; body: React.ReactNode; wide?: boolean };

export interface Screen { title: string; sub?: string; layer: string; blocks: Block[]; showGrain?: boolean; footnote?: string }

const fmtMoney = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};
export function fmtKpi(v: KpiValue | undefined, cur: string) {
  if (!v || v.v === null || v.v === undefined) return "N/A";
  if (typeof v.v === "string") return v.v;
  switch (v.unit) {
    case "money": return `${cur} ${fmtMoney(v.v)}`;
    case "pct": return `${(v.v * 100).toFixed(1)}%`;
    case "count": return Math.round(v.v).toLocaleString("en-US");
    case "days": return `${v.v.toFixed(1)} d`;
    case "pts": return `${v.v >= 0 ? "+" : ""}${v.v.toFixed(1)} pts`;
    case "index": return Math.round(v.v).toLocaleString("en-US");
    default: return v.v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}
/** "Good" direction per KPI for the variance colour (costs, returns, overdue, ageing… are better when lower). */
const LOWER_IS_BETTER = /^(REV-002|REV-003|ORD-007|ORD-008|ORD-009|ORD-010|ORD-015|FUL-003|FUL-007|FUL-009|FUL-011|CUS-005|CUS-011|CUS-012|CUS-016|MAR-001|MAR-005|MAR-007|PRI-003|PRI-004|PRI-011|RET-|AR-002|AR-00[4-7]|AR-010|AR-011|AR-012|AR-013|TAR-006|TAR-007|TEA-007)/;

function MetricCard({ v, cur, s }: { v: KpiValue | undefined; cur: string; s: SiScope }) {
  const k = v ? kpi(v.id) : undefined;
  if (!v || !k) return null;
  const d = v.delta;
  const good = d === null || d === undefined ? null : LOWER_IS_BETTER.test(v.id) ? d <= 0 : d >= 0;
  const deltaTxt = d === null || d === undefined ? null : v.unit === "pct" ? `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pts` : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
  return (
    <div className="bg-surface px-4 py-3 grid content-start gap-0.5 min-w-0 si-rise">
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate" title={k.name}>{k.name}</span>
        <Link href={siHref(s, "/si/kpis", { k: k.id })} className="text-[10px] text-muted hover:text-accent num shrink-0" title={`${k.id} · ${k.definition}`}>{k.id}</Link>
      </div>
      <span dir="ltr" className="num text-[20px] font-semibold tracking-tight truncate text-start [unicode-bidi:isolate]" title={typeof v.v === "number" ? v.v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : undefined}>{fmtKpi(v, cur)}</span>
      <span className="text-[11.5px] text-muted flex flex-wrap gap-x-2">
        {deltaTxt && <span dir="ltr" className={`[unicode-bidi:isolate] ${good ? "text-good font-medium" : "text-bad font-medium"}`}>{deltaTxt}</span>}
        {deltaTxt && s.pc.comparisonLabel && <span>vs {s.pc.comparisonLabel}</span>}
        {!deltaTxt && v.prev === 0 && s.compare !== "none" && <span title="The comparison value is zero, so growth is not defined">vs 0 · growth N/A</span>}
        {v.note && <span className="truncate" title={v.note}>{v.note}</span>}
      </span>
    </div>
  );
}

function Panel({ title, sub, children, wide }: { title: string; sub?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`card p-4 min-w-0 si-rise ${wide ? "xl:col-span-2" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold text-[14px]">{title}</h2>
        {sub && <span className="text-[12px] text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export function SiView({ s, screen, kpis, options, exportName }: { s: SiScope; screen: Screen; kpis: Map<string, KpiValue>; options: Record<string, { v: string; l: string }[]>; exportName: string }) {
  const cur = s.co.currency;
  const demo = s.co.mode === "DEMO";
  const pc = s.pc;
  const blocks: React.ReactNode[] = [];
  let grid: React.ReactNode[] = [];
  const flush = () => { if (grid.length) { blocks.push(<div key={`g${blocks.length}`} className="grid gap-4 mb-4 xl:grid-cols-2">{grid}</div>); grid = []; } };
  screen.blocks.forEach((b, i) => {
    if (b.t === "kpis") {
      flush();
      blocks.push(
        <section key={i} className="mb-4">
          {b.title && <div className="label mb-1.5">{b.title}</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-px bg-line border border-line rounded-xl overflow-hidden">
            {b.ids.map((id) => <MetricCard key={id} v={kpis.get(id)} cur={cur} s={s} />)}
          </div>
        </section>);
      return;
    }
    if (b.t === "note") { flush(); blocks.push(<div key={i} className={`rounded-lg border px-3.5 py-2.5 text-[13px] mb-4 ${b.tone === "warn" ? "border-warn/40 bg-warn/5" : "border-line bg-surface"}`}>{b.text}</div>); return; }
    const el = b.t === "trend" ? <TrendChart data={b.data} cur={cur} curName={b.curName} prevName={b.prevName} cumulative={b.cumulative} />
      : b.t === "waterfall" ? <Waterfall steps={b.steps} cur={cur} />
      : b.t === "rank" ? (b.rows.length ? <RankList rows={b.rows} cur={b.money === false ? undefined : cur} /> : <Empty />)
      : b.t === "heat" ? <Heatmap weeks={b.weeks} days={b.days} cur={cur} />
      : b.t === "funnel" ? <LayerFunnel steps={b.steps} cur={cur} />
      : b.t === "pareto" ? (b.rows.length ? <Pareto rows={b.rows} cur={cur} /> : <Empty />)
      : b.t === "donut" ? (b.data.length ? <Donut data={b.data} cur={cur} center={b.center} centerLabel={b.centerLabel} /> : <Empty />)
      : b.t === "table" ? <DataTable exportName={`${exportName} ${b.title} ${s.co.company}`} cols={b.cols} rows={b.rows} total={b.total} maxHeight={b.maxHeight ?? 520} />
      : b.body;
    const wide = b.wide || b.t === "table";
    if (wide) { flush(); blocks.push(<div key={i} className="mb-4"><Panel title={b.title} sub={b.sub} wide>{el}</Panel></div>); }
    else grid.push(<Panel key={i} title={b.title} sub={b.sub}>{el}</Panel>);
  });
  flush();
  const badges = [pc.isPartial ? "OPEN PERIOD" : pc.full.end < s.asOf ? "CLOSED" : "FULL PERIOD", demo ? "DEMO DATA" : "D365 DATA"];
  const active = Object.fromEntries(Object.entries(s.f.dims).filter(([d]) => !(d === "salesperson" && s.pinnedRep)).map(([d, v]) => [d, v ?? []]));
  return (
    <>
      <section className="rounded-2xl mb-4 px-5 py-4 text-white si-hero">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[.12em] uppercase text-white/60 font-semibold">ONE365 · Sales Intelligence · {screen.layer}</div>
            <h1 className="text-[24px] font-semibold tracking-tight mt-1 [text-wrap:balance]">{screen.title}</h1>
            <p className="text-[13px] text-white/75 mt-0.5">{screen.sub ?? <>{pc.label} · {pc.current.start} → {pc.current.end}{pc.comparisonLabel ? <> · compared with {pc.comparisonLabel} ({pc.comparison!.start} → {pc.comparison!.end}, {s.basis === "trading" ? "matched trading days" : "matched calendar days"})</> : null}</>}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {badges.map((b) => <span key={b} className={`px-2.5 py-1 rounded-full text-[11px] font-bold tracking-[.06em] ${b === "DEMO DATA" ? "bg-[#F48C36] text-[#1B0D00]" : "bg-white/12 text-white border border-white/20"}`}>{b}</span>)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-white/70">
          <span>{s.co.company.toUpperCase()} · {s.co.name}</span><span>Amounts in {cur} (accounting currency), ex-VAT</span>
          <span>Data as of {s.co.data_as_of ?? "–"}</span><span>{pc.elapsedTradingDays} of {pc.totalTradingDays} trading days</span>
          <span>Powered by Grow Path</span>
        </div>
      </section>
      <nav className="flex gap-1 overflow-x-auto mb-3 pb-1 text-[12.5px]" aria-label="Sales Intelligence screens">
        {SI_NAV.map((n) => <Link key={n.href} href={siHref(s, n.href)} className="px-2.5 py-1 rounded-full border border-line bg-surface hover:border-ink whitespace-nowrap">{n.label}</Link>)}
      </nav>
      <Suspense>
        <SiFilters companies={s.companies} company={s.co.company} asOf={s.asOf} grain={s.grain} compare={s.compare} basis={s.basis} full={s.q.full === "1"}
          showGrain={screen.showGrain !== false} options={options} active={active} labels={dimLabel} pinnedRep={!!s.pinnedRep} />
      </Suspense>
      {demo && <div className="rounded-lg border border-[#F48C36]/50 bg-[#F48C36]/8 px-3.5 py-2 text-[12.5px] mb-4"><b>DEMO DATA</b> · deterministic sample company built for testing (seed 3652026). These are not real sales figures.</div>}
      {blocks}
      <footer className="text-[11.5px] text-muted mt-2 max-w-4xl leading-relaxed">
        {screen.footnote ? <>{screen.footnote} </> : null}
        Net Sales = posted invoice and credit-note lines, net of line discount, excluding VAT, by invoice date, in the company&apos;s accounting currency. Orders use creation date, deliveries the packing-slip date, collections the payment/settlement date; backlog and receivables are snapshots as of the period end, never summed across days. Growth with a zero base shows N/A. <Link className="link" href={siHref(s, "/si/kpis")}>Metric dictionary</Link> · <Link className="link" href={siHref(s, "/si/recon")}>Reconciliation</Link>
      </footer>
    </>
  );
}
function Empty() { return <div className="text-muted text-[13px] py-8 text-center">No data for this selection.</div>; }
