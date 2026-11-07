import { reportScope, one, today } from "@/lib/page";
import { openOrders } from "@/lib/reports/sales";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty, Note } from "@/components/ui";
import { BucketBars } from "@/components/charts";
import DataTable from "@/components/DataTable";
import AsOf from "@/components/AsOf";

export const dynamic = "force-dynamic";
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.asof) ?? "") ? one(searchParams.asof)! : today();
  const rows = await openOrders(s, asOf);
  const c = s.currency;
  // Week starts on Sunday (Egypt / KSA working week).
  const start = Date.parse(asOf) - new Date(asOf).getUTCDay() * DAY;
  const weeks = Array.from({ length: 6 }, (_, i) => ({ from: start + i * 7 * DAY, to: start + (i + 1) * 7 * DAY - DAY }));
  const ship = (r: (typeof rows)[number]) => Date.parse(String(r.ship_date).slice(0, 10));
  const overdue = rows.filter((r) => ship(r) < start);
  const data = [
    { label: "Overdue", value: overdue.reduce((a, r) => a + Number(r.value), 0), color: "var(--c2)" },
    ...weeks.map((w, i) => ({ label: i === 0 ? "This week" : `Wk of ${dateFmt(iso(w.from)).slice(0, 6)}`, color: "var(--c1)",
      value: rows.filter((r) => ship(r) >= w.from && ship(r) <= w.to).reduce((a, r) => a + Number(r.value), 0) })),
  ];
  const thisWeek = rows.filter((r) => ship(r) >= weeks[0].from && ship(r) <= weeks[0].to);
  const toShip = [...overdue, ...thisWeek];
  const short = toShip.filter((r) => r.available !== null && Number(r.available) < Number(r.qty));

  return (
    <>
      <PageHead title="Delivery Schedule" sub={<>Open order lines by ship week (Sunday–Saturday) · week of {dateFmt(iso(start))}</>} />
      <Filters s={s} show={{ period: false }} extra={<AsOf value={asOf} label="Week containing" />} />
      <Note>Shipped-but-not-invoiced packing slips need a custom D365 entity (no standard packing-slip entity is exposed); they will appear here once it is added to the sync.</Note>
      <KpiRow>
        <Kpi label="Due this week" value={fmt(thisWeek.length)} note={`lines · ${money(thisWeek.reduce((a, r) => a + Number(r.value), 0), c)}`} />
        <Kpi label="Overdue" value={fmt(overdue.length)} note={`lines · ${money(data[0].value, c)}`} tone={overdue.length ? "bad" : "good"} />
        <Kpi label="Orders to ship" value={fmt(new Set(toShip.map((r) => r.sales_order)).size)} note="overdue + this week" />
        <Kpi label="Stock shortages" value={fmt(short.length)} note="lines to ship with not enough available stock" tone={short.length ? "warn" : null} />
        <Kpi label="Next 5 weeks" value={money(data.slice(2).reduce((a, d) => a + d.value, 0), c)} note="scheduled value" />
        <Kpi label="Warehouses" value={fmt(new Set(toShip.map((r) => r.warehouse)).size)} note="shipping overdue + this week" />
      </KpiRow>
      <Panel title="Value to ship by week" sub={c} className="mb-4"><BucketBars cur={c} data={data} /></Panel>
      <Panel title="To ship: overdue and this week" sub="sorted by ship date">
        <DataTable exportName={`Delivery schedule ${s.company} ${asOf}`} rows={toShip.sort((a, b) => ship(a) - ship(b)).map((r) => ({ ...r, stock: r.available === null ? "–" : Number(r.available) < Number(r.qty) ? "Short" : "OK" }))}
          cols={[{ key: "ship_date", label: "Ship date", type: "date" }, { key: "sales_order", label: "Order" }, { key: "customer_name", label: "Customer" },
            { key: "item", label: "Item" }, { key: "description", label: "Description" }, { key: "qty", label: "Qty", type: "num" }, { key: "unit", label: "Unit" },
            { key: "warehouse", label: "Warehouse" }, { key: "available", label: "Available (site)", type: "num" }, { key: "stock", label: "Stock" },
            { key: "value", label: `Value (${c})`, type: "money" }]}
          empty="Nothing is due to ship this week." />
      </Panel>
    </>
  );
}
