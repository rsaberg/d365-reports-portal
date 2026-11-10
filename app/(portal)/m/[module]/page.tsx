import { notFound } from "next/navigation";
import { reportScope, one, today } from "@/lib/page";
import { moduleByKey, type Ctx } from "@/lib/reports/modules";
import { ensureDemo } from "@/lib/reports/demo";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty, Note } from "@/components/ui";
import { BucketBars, PairBars, RankBars } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { DASHBOARDS } from "@/lib/reports/dashboards";
import { DashView } from "@/components/dash";
import { EXTRA_DASHBOARDS, EXTRA_MODULES } from "@/lib/reports/costsec";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: { module: string }; searchParams: Record<string, string> }) {
  const mod = moduleByKey(params.module) ?? EXTRA_MODULES.find((m) => m.key === params.module);
  const dash = DASHBOARDS[params.module] ?? EXTRA_DASHBOARDS[params.module];
  if (!mod && !dash) notFound();
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  if (s.user.role === "sales" && params.module !== "margin") return <Empty>This section is open to administrators and managers.</Empty>;
  if (params.module === "security" && s.user.role !== "admin") return <Empty>User security is open to administrators.</Empty>;
  const t = today();
  const asOf = s.to < t ? s.to : t;
  const ctx: Ctx = { s, company: s.company, from: s.from, to: s.to, asOf, cur: s.mst || s.currency, q: searchParams };
  const r = one(searchParams.r);
  // A module opens on its dashboard; ?r=<report> opens one of its reports.
  if (dash && (!mod || !r || r === "dashboard" || !mod.reports.some((x) => x.key === r))) {
    if (dash.demo) await ensureDemo(s.company);
    const spec = await dash.run(ctx);
    return (
      <>
        <PageHead title={`${dash.title} Dashboard`} sub={<>{s.company.toUpperCase()} · {dash.sub} · {ctx.cur} · {s.from} – {s.to}</>} />
        <Filters s={s} show={{ currency: false, group: false }} />
        <DashView spec={spec} cur={ctx.cur} asOf={asOf} />
        <p className="text-[12px] text-muted">Values in {ctx.cur} · Source: D365 {s.company.toUpperCase()} · balances as of {asOf}{dash.demo ? " · some figures use demo data until the custom D365 entities are synced" : ""}</p>
      </>
    );
  }
  if (!mod) notFound();
  const rep = mod.reports.find((x) => x.key === r) ?? mod.reports[0];
  if (rep.demo) await ensureDemo(s.company);
  const spec = await rep.run(ctx);

  return (
    <>
      <PageHead title={mod.reports.length > 1 ? `${mod.title} · ${rep.label}` : mod.title} sub={<>{s.company.toUpperCase()} · {mod.sub} · {ctx.cur} · balances as of {asOf}</>} />
      <Filters s={s} show={{ currency: false, group: false }} />
      {rep.demo && <Note>Demo data: this report runs on a small sample built from the company&apos;s real items, customers and vendors. It switches to D365 data once the custom entity for it is synced.</Note>}
      {spec.kpis && spec.kpis.length > 0 && (
        <KpiRow>{spec.kpis.map((k) => <Kpi key={k.label} label={k.label} value={k.value} note={k.note} tone={k.tone ?? null} />)}</KpiRow>
      )}
      {spec.charts && spec.charts.length > 0 && (
        <section className={`grid gap-4 mb-4 ${spec.charts.length > 1 ? "xl:grid-cols-2" : ""}`}>
          {spec.charts.map((c) => (
            <Panel key={c.title} title={c.title} sub={c.sub ?? (c.money ? ctx.cur : undefined)}>
              {!c.data.length ? <Empty>No data for this period.</Empty>
                : c.kind === "rank" ? <RankBars data={c.data} cur={c.money ? ctx.cur : undefined} />
                : c.kind === "pair" ? <PairBars data={c.data} a={c.a!} b={c.b!} cur={c.money ? ctx.cur : undefined} />
                : <BucketBars data={c.data} cur={c.money ? ctx.cur : undefined} />}
            </Panel>
          ))}
        </section>
      )}
      {spec.tables?.map((tb) => (
        <Panel key={tb.title} title={tb.title} sub={tb.sub} className="mb-4">
          <DataTable exportName={`${rep.label} ${s.company}`} cols={tb.cols} rows={tb.rows} total={tb.total} maxHeight={tb.maxHeight} />
        </Panel>
      ))}
      {spec.note && <p className="text-[12px] text-muted mt-2 max-w-3xl">{spec.note}</p>}
    </>
  );
}
