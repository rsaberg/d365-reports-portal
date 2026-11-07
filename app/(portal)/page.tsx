import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getScope, qs } from "@/lib/filters";
import { dashboard } from "@/lib/reports/dashboard";
import { pct } from "@/lib/reports/common";
import { money, pctFmt, dateFmt, fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { MonthlyCompare, RankBars } from "@/components/charts";
import DataTable from "@/components/DataTable";
import { SALES_REPORTS } from "@/lib/nav";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  if (!user.companies.length) return <Empty>Your account has no company access yet. Ask your administrator to assign one.</Empty>;
  const s = await getScope(user, searchParams);
  const d = await dashboard(s);
  const c = s.currency;
  const growth = pct(d.k.net, d.p.net);
  const avg = d.k.invoices ? d.k.net / d.k.invoices : 0;
  const q = qs(s);

  return (
    <>
      <PageHead title="Sales dashboard"
        sub={<>{s.companies.find((x) => x.company === s.company)?.name} · {dateFmt(s.from)} – {dateFmt(s.to)} · compared with the same period last year</>} />
      <Filters s={s} />

      <KpiRow>
        <Kpi label="Net sales" value={money(d.k.net, c)} note={d.p.net ? `${pctFmt(growth)} vs last year` : "No sales last year"} tone={growth === null ? null : growth >= 0 ? "good" : "bad"} href={`/sales/performance?${q}`} />
        <Kpi label="Invoices" value={fmt(d.k.invoices)} note={`${fmt(d.p.invoices)} last year`} href={`/sales/invoices?${q}`} />
        <Kpi label="Avg invoice value" value={money(avg, c)} note="net sales ÷ invoices" />
        <Kpi label="Active customers" value={fmt(d.k.customers)} note={`${fmt(d.p.customers)} last year`} />
        <Kpi label="Open orders" value={money(d.oo.value, c)} note={d.oo.late_value ? `${money(d.oo.late_value, c)} past ship date` : `${fmt(d.oo.orders)} orders`} tone={d.oo.late_value ? "bad" : null} href={`/sales/open-orders?${q}`} />
        <Kpi label="Receivables" value={money(d.ar.total, s.mst)} note={d.ar.overdue ? `${money(d.ar.overdue, s.mst)} overdue` : "nothing overdue"} tone={d.ar.overdue ? "bad" : "good"} href={`/sales/aging?${q}`} />
      </KpiRow>

      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4 mb-4">
        <Panel title="Net sales by month" sub={`${c} · invoiced, excluding tax`}>
          <MonthlyCompare data={d.monthly} cur={c} />
        </Panel>
        <Panel title="Top customers" sub={`${c} net sales`} action={<Link className="text-[12px] text-accent hover:underline" href={`/sales/performance?${q}`}>All customers</Link>}>
          {d.topCustomers.length ? <RankBars cur={c} data={d.topCustomers.map((r) => ({ label: r.name, value: r.net }))} /> : <Empty>No sales in this period.</Empty>}
        </Panel>
      </div>

      <div className="grid xl:grid-cols-[1fr_1.6fr] gap-4 mb-4">
        <Panel title="Sales by product category" sub={`${c} net sales`}>
          {d.byCategory.length ? <RankBars cur={c} data={d.byCategory.map((r) => ({ label: r.category, value: r.net }))} /> : <Empty>No sales in this period.</Empty>}
        </Panel>
        <Panel title="Top items" sub="growth compares with the same period last year">
          <DataTable maxHeight={360}
            cols={[{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "qty", label: "Qty", type: "num" },
              { key: "net", label: `Net (${c})`, type: "money" }, { key: "growth", label: "vs LY", type: "pct", tone: "signed" }]}
            rows={d.topItems.map((r) => ({ ...r, growth: r.prev ? (r.net - r.prev) / r.prev : null }))} />
        </Panel>
      </div>

      <Panel title="Sales reports" sub="every report keeps the company, period and currency you picked here">
        <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">
          {SALES_REPORTS.map((r) => (
            <Link key={r.href} href={`${r.href}?${q}`} className="rounded-md border border-line px-3 py-2.5 hover:border-accent hover:bg-sunken/50">
              <div className="font-medium text-[13px]">{r.title}</div>
              <div className="text-muted text-[12px] mt-0.5">{r.desc}</div>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
