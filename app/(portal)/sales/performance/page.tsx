import { reportScope, one } from "@/lib/page";
import { qs } from "@/lib/filters";
import { performance } from "@/lib/reports/sales";
import { dashboard } from "@/lib/reports/dashboard";
import { pct } from "@/lib/reports/common";
import { money, pctFmt, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty, Tabs } from "@/components/ui";
import { MonthlyCompare } from "@/components/charts";
import DataTable, { Col } from "@/components/DataTable";

export const dynamic = "force-dynamic";
const DIMS = { customer: "Customer", item: "Item", category: "Category", group: "Customer group", month: "Month" } as const;

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const by = (Object.keys(DIMS).includes(one(searchParams.by) ?? "") ? one(searchParams.by) : "customer") as keyof typeof DIMS;
  const [rows, d] = await Promise.all([performance(s, by), dashboard(s)]);
  const c = s.currency;
  const net = rows.reduce((a, r) => a + r.net, 0);
  const growth = pct(d.k.net, d.p.net);

  const cols: Col[] = [
    { key: "key", label: DIMS[by], ...(by === "customer" ? { href: `/sales/statement?${qs(s)}&customer={key}` } : {}) },
    ...(by === "customer" || by === "item" ? [{ key: "name", label: "Name" } as Col] : []),
    { key: "invoices", label: "Invoices", type: "int" }, { key: "qty", label: "Qty", type: "num" },
    { key: "net", label: `Net sales (${c})`, type: "money" }, { key: "share", label: "Share", type: "pct" },
    { key: "prev", label: `Last year (${c})`, type: "money" }, { key: "growth", label: "Growth", type: "pct", tone: "signed" },
    { key: "discount", label: "Discount", type: "money" },
  ];

  return (
    <>
      <PageHead title="Sales Performance" sub={<>Invoiced net sales excluding tax · {dateFmt(s.from)} – {dateFmt(s.to)} vs same period last year</>} />
      <Filters s={s} />
      <KpiRow>
        <Kpi label="Net sales" value={money(d.k.net, c)} note={`${pctFmt(growth)} vs last year`} tone={growth === null ? null : growth >= 0 ? "good" : "bad"} />
        <Kpi label="Last year" value={money(d.p.net, c)} note={`${dateFmt(s.prevFrom)} – ${dateFmt(s.prevTo)}`} />
        <Kpi label="Invoices" value={fmt(d.k.invoices)} note={`${fmt(d.p.invoices)} last year`} />
        <Kpi label="Units sold" value={fmt(d.k.qty)} note="all units of measure" />
        <Kpi label="Discounts" value={money(d.k.discount, c)} note={d.k.net ? `${((d.k.discount / (d.k.net + d.k.discount)) * 100).toFixed(1)}% of gross` : undefined} />
        <Kpi label="Active customers" value={fmt(d.k.customers)} note={`${fmt(d.p.customers)} last year`} />
      </KpiRow>
      <Panel title="Net sales by month" sub={`${c}`} className="mb-4"><MonthlyCompare data={d.monthly} cur={c} /></Panel>
      <Panel title={`Net sales by ${DIMS[by].toLowerCase()}`}>
        <Tabs active={by} items={Object.entries(DIMS).map(([k, label]) => ({ key: k, label, href: `?${qs(s, { by: k })}` }))} />
        <DataTable exportName={`Sales by ${DIMS[by]} ${s.company} ${s.from} ${s.to}`} cols={cols} rows={rows}
          total={{ key: "Total", net, invoices: d.k.invoices, prev: rows.reduce((a, r) => a + r.prev, 0), discount: rows.reduce((a, r) => a + r.discount, 0) }} />
      </Panel>
    </>
  );
}
