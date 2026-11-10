import Link from "next/link";
import { addMonths, finQs, finScope, movementByMonth, rangeLabel, ratios, type Bal } from "@/lib/gl/fin";
import { inRole, isPL } from "@/lib/gl/structure";
import { FinHead, NoFinance } from "@/components/FinShell";
import { Kpi, KpiRow, Panel } from "@/components/ui";
import { MonthlyCompare } from "@/components/charts";
import { Card, TILE_COLORS, Tile, short } from "@/components/dash";
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
  const vsShort = f.compare === "pp" ? "vs previous period" : "vs last year";
  return (
    <>
      <FinHead f={f} title="Finance Dashboard" compares={COMPARES} />
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Tile label="Revenue" value={short(a.revenue)} unit={c} change={ch(a.revenue, b.revenue)} vs={vsShort} color={TILE_COLORS[0]} icon="money" href={`/finance/income?${qs}`} />
        <Tile label="Gross profit" value={short(a.gp)} unit={c} change={ch(a.gp, b.gp)} vs={vsShort} color={TILE_COLORS[1]} icon="profit" href={`/finance/income?${qs}`} />
        <Tile label="Net profit" value={short(a.np)} unit={c} change={ch(a.np, b.np)} vs={vsShort} color={TILE_COLORS[2]} icon="pie" href={`/finance/income?${qs}`} />
        <Tile label="Total assets" value={short(a.assets)} unit={c} change={ch(a.assets, b.assets)} vs={vsShort} color={TILE_COLORS[3]} icon="box" href={`/finance/balance?${qs}`} />
        <Tile label="Equity" value={short(a.equity)} unit={c} change={ch(a.equity, b.equity)} vs={vsShort} color={TILE_COLORS[4]} icon="tag" href={`/finance/balance?${qs}`} />
        <Tile label="Cash and banks" value={short(a.cash)} unit={c} change={ch(a.cash, b.cash)} vs={vsShort} color={TILE_COLORS[5]} icon="bank" href={`/finance/cashflow?${qs}`} />
      </section>
      <div className="grid xl:grid-cols-2 gap-4 mb-4">
        <Card title="Revenue by month"><MonthlyCompare data={revData} cur={c} /></Card>
        <Card title="Net profit by month"><MonthlyCompare data={npData} cur={c} /></Card>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {cur.groups.map((g, gi) => (
          <Card key={g.name} title={g.name}>
            <ul className="grid gap-1.5 text-[13px]">
              {g.items.slice(0, 4).map((it, i) => {
                const p = prev.groups[gi].items[i].v;
                const fm = (v: number | null) => v === null || !Number.isFinite(v) ? "–" : it.f === "x" ? `${v.toFixed(2)}×` : it.f === "pct" ? `${(v * 100).toFixed(1)}%` : it.f === "days" ? `${Math.round(v)}d` : money(v);
                return <li key={it.k} className="flex justify-between gap-2"><span className="text-muted">{it.k}</span><span className="num">{fm(it.v)} <span className="text-muted text-[11px]">({fm(p)})</span></span></li>;
              })}
            </ul>
          </Card>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {FINANCE.slice(1).map((p) => <Link key={p.href} href={`${p.href}?${qs}`} className="card px-4 py-3 hover:bg-sunken text-[13px] font-medium">{p.title} →</Link>)}
      </div>
    </>
  );
}
