import { reportScope, one, today } from "@/lib/page";
import { openOrders } from "@/lib/reports/sales";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty, Note } from "@/components/ui";
import { BucketBars } from "@/components/charts";
import DataTable from "@/components/DataTable";
import AsOf from "@/components/AsOf";
import { SHIP_BUCKETS } from "@/lib/buckets";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.asof) ?? "") ? one(searchParams.asof)! : today();
  const rows = (await openOrders(s, asOf)).map((r) => ({ ...r, short: r.available !== null && Number(r.available) < Number(r.qty) }));
  const c = s.currency;
  const late = rows.filter((r) => r.days_late > 0);
  const total = rows.reduce((a, r) => a + Number(r.value), 0);
  const lateVal = late.reduce((a, r) => a + Number(r.value), 0);
  const buckets = SHIP_BUCKETS.map((b) => ({ label: b.label, color: b.color, value: rows.filter((r) => b.test(r.days_late)).reduce((a, r) => a + Number(r.value), 0) }));
  const short = rows.filter((r) => r.short);

  return (
    <>
      <PageHead title="Open Sales Orders" sub={<>Order lines not yet delivered (status Open order) · ship date = confirmed, else requested · as of {dateFmt(asOf)}</>} />
      <Filters s={s} show={{ period: false, group: true }} extra={<AsOf value={asOf} />} />
      <Note>
        D365&apos;s standard order-line entity has no <b>remaining quantity</b>, so value uses the ordered quantity. Lines that are partly delivered
        are overstated until the custom remaining-quantity entity is added to the sync.
      </Note>
      <KpiRow>
        <Kpi label="Open orders" value={fmt(new Set(rows.map((r) => r.sales_order)).size)} note={`${fmt(rows.length)} lines`} />
        <Kpi label="Open value" value={money(total, c)} note="ordered qty × net price" />
        <Kpi label="Past ship date" value={money(lateVal, c)} note={total ? `${((lateVal / total) * 100).toFixed(0)}% of backlog` : undefined} tone={lateVal ? "bad" : "good"} />
        <Kpi label="Late lines" value={fmt(late.length)} tone={late.length ? "bad" : null} note={late.length ? `avg ${Math.round(late.reduce((a, r) => a + r.days_late, 0) / late.length)} days late` : "none"} />
        <Kpi label="Stock shortage" value={fmt(short.length)} note="lines where available stock < qty" tone={short.length ? "warn" : null} />
        <Kpi label="Customers waiting" value={fmt(new Set(rows.map((r) => r.customer)).size)} />
      </KpiRow>
      <Panel title="Open value by ship date" sub={c} className="mb-4"><BucketBars data={buckets} cur={c} /></Panel>
      <Panel title="Open order lines" sub="most overdue first">
        <DataTable exportName={`Open orders ${s.company} ${asOf}`} rows={rows.map((r) => ({ ...r, stock: r.available === null ? "–" : r.short ? "Short" : "OK" }))}
          cols={[{ key: "sales_order", label: "Order" }, { key: "customer_name", label: "Customer" }, { key: "item", label: "Item" },
            { key: "description", label: "Description" }, { key: "qty", label: "Qty", type: "num" }, { key: "unit", label: "Unit" },
            { key: "value", label: `Value (${c})`, type: "money" }, { key: "ship_date", label: "Ship date", type: "date" },
            { key: "days_late", label: "Days late", type: "int", tone: "badIfPositive" }, { key: "warehouse", label: "Warehouse" },
            { key: "available", label: "Available (site)", type: "num" }, { key: "stock", label: "Stock" }, { key: "responsible_name", label: "Responsible" }]}
          total={{ sales_order: "Total", value: total }} />
      </Panel>
    </>
  );
}
