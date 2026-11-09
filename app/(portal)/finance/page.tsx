import Link from "next/link";
import { addMonths, finQs, finScope, movementByMonth, rangeLabel, ratios, type Bal } from "@/lib/gl/fin";
import { inRole, isPL } from "@/lib/gl/structure";
import { FinHead, NoFinance } from "@/components/FinShell";
import { Kpi, KpiRow, Panel } from "@/components/ui";
import { MonthlyCompare } from "@/components/charts";
import { money, pctFmt } from "@/lib/format";
import { FINANCE } from "@/lib/nav";

export const dynamic = "force-dynamic";
const COMPARES = [{ v: "py", label: "Same period last year" }, { v: "pp", label: "Previous period" }];

export default async function FinanceOverview({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope({ ...searchParams, compare: searchParams.compare === "pp" ? "pp" : "py" });
  if (!f) return <NoFinance />;
  const n = Math.max(1, (Number(f.toM.slice(0, 4)) - Number(f.fromM.slice(0, 4))) * 12 + Number(f.toM.slice(5)) - Number(f.fromM.slice(5)) + 1);
  const cf: [string, string] = f.compare === "pp" ? [addMonths(f.fromM, -n), addMonths(f.fromM, -1)] : [addMonths(f.fromM, -12), addMonths(f.toM, -12)];
  const [cur, prev, mNow, mPrev] = await Promise.all([ratios(f, f.fromM, f.toM), ratios(f, cf[0], cf[1]), movementByMonth(f, f.fromM, f.toM), movementByMonth(f, addMonths(f.fromM, -12), addMonths(f.toM, -12))]);
  const a = cur.figures, b = prev.figures;
  const ch = (x: number, y: number) => (y ? (x - y) / Math.abs(y) : null);
  const tone = (x: number | null, goodUp = true) => (x === null ? null : (x >= 0) === goodUp ? "good" as const : "bad" as const);
  const rev = (bal?: Bal) => -[...(bal ?? new Map())].filter(([k]) => isPL(f.s, k) && inRole(f.s, "revenue", k)).reduce((s, [, v]) => s + v, 0);
  const np = (bal?: Bal) => -[...(bal ?? new Map())].filter(([k]) => isPL(f.s, k)).reduce((s, [, v]) => s + v, 0);
  const months = Array.from({ length: Math.min(n, 24) }, (_, i) => addMonths(f.toM, -Math.min(n, 24) + 1 + i));
  const revData = months.map((m) => ({ m, cur: rev(mNow.get(m)), prev: rev(mPrev.get(addMonths(m, -12))) }));
  const npData = months.map((m) => ({ m, cur: np(mNow.get(m)), prev: np(mPrev.get(addMonths(m, -12))) }));
  const c = f.currency;
  const vs = `vs ${rangeLabel(cf[0], cf[1])}`;
  const qs = finQs(f);
  return (
    <>
      <FinHead f={f} title="Financial overview" compares={COMPARES} />
      <KpiRow>
        <Kpi label="Revenue" value={money(a.revenue, c)} note={`${pctFmt(ch(a.revenue, b.revenue))} ${vs}`} tone={tone(ch(a.revenue, b.revenue))} href={`/finance/income?${qs}`} />
        <Kpi label="Gross profit" value={money(a.gp, c)} note={`margin ${a.revenue ? ((a.gp / a.revenue) * 100).toFixed(1) : "–"}% (was ${b.revenue ? ((b.gp / b.revenue) * 100).toFixed(1) : "–"}%)`} tone={tone(a.revenue && b.revenue ? a.gp / a.revenue - b.gp / b.revenue : null)} href={`/finance/income?${qs}`} />
        <Kpi label="Net profit" value={money(a.np, c)} note={`${pctFmt(ch(a.np, b.np))} ${vs}`} tone={tone(a.np - b.np)} href={`/finance/income?${qs}`} />
        <Kpi label="Total assets" value={money(a.assets, c)} note={`${pctFmt(ch(a.assets, b.assets))} vs then`} href={`/finance/balance?${qs}`} />
        <Kpi label="Equity" value={money(a.equity, c)} note={`${pctFmt(ch(a.equity, b.equity))} vs then`} tone={tone(a.equity - b.equity)} href={`/finance/balance?${qs}`} />
        <Kpi label="Cash and banks" value={money(a.cash, c)} note={`${pctFmt(ch(a.cash, b.cash))} vs then`} tone={tone(a.cash - b.cash)} href={`/finance/cashflow?${qs}`} />
      </KpiRow>
      <div className="grid xl:grid-cols-2 gap-4 mb-4">
        <Panel title="Revenue by month" sub={`${c} · vs same month last year`}><MonthlyCompare data={revData} cur={c} /></Panel>
        <Panel title="Net profit by month" sub={`${c} · vs same month last year`}><MonthlyCompare data={npData} cur={c} /></Panel>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {cur.groups.map((g, gi) => (
          <Panel key={g.name} title={g.name}>
            <ul className="grid gap-1.5 text-[13px]">
              {g.items.slice(0, 4).map((it, i) => {
                const p = prev.groups[gi].items[i].v;
                const fm = (v: number | null) => v === null || !Number.isFinite(v) ? "–" : it.f === "x" ? `${v.toFixed(2)}×` : it.f === "pct" ? `${(v * 100).toFixed(1)}%` : it.f === "days" ? `${Math.round(v)}d` : money(v);
                return <li key={it.k} className="flex justify-between gap-2"><span className="text-muted">{it.k}</span><span className="num">{fm(it.v)} <span className="text-muted text-[11px]">({fm(p)})</span></span></li>;
              })}
            </ul>
          </Panel>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {FINANCE.slice(1).map((p) => <Link key={p.href} href={`${p.href}?${qs}`} className="card px-4 py-3 hover:bg-sunken text-[13px] font-medium">{p.title} →</Link>)}
      </div>
    </>
  );
}
