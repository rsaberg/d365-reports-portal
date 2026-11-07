import { reportScope } from "@/lib/page";
import { returns } from "@/lib/reports/sales";
import { money, fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { RankBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const { orders, items } = await returns(s);
  const c = s.currency;
  const value = orders.reduce((a, r) => a + Math.abs(Number(r.total)), 0);
  const byReason = new Map<string, number>();
  for (const o of orders) byReason.set(o.reason, (byReason.get(o.reason) ?? 0) + Math.abs(Number(o.total)));
  const open = orders.filter((o) => o.return_status === 1 || o.return_status === 2);

  return (
    <>
      <PageHead title="Returns" sub="Return orders (RMAs) with reason, status and returned items · all open and historical returns" />
      <Filters s={s} show={{ period: false }} />
      <KpiRow>
        <Kpi label="Return orders" value={fmt(orders.length)} note={`${fmt(items.reduce((a, r) => a + r.lines, 0))} lines`} />
        <Kpi label="Returned value" value={money(value, c)} />
        <Kpi label="Open returns" value={fmt(open.length)} note="created or open" tone={open.length ? "warn" : null} />
        <Kpi label="Units returned" value={fmt(items.reduce((a, r) => a + Number(r.qty), 0))} />
        <Kpi label="Items returned" value={fmt(items.length)} />
        <Kpi label="With replacement" value={fmt(orders.filter((o) => o.replacement_order).length)} note="replacement order created" />
      </KpiRow>
      {!orders.length ? <Panel title="Return orders"><Empty>No return orders in {s.company.toUpperCase()} for {c}.</Empty></Panel> : (
        <>
          <div className="grid xl:grid-cols-[1fr_1.4fr] gap-4 mb-4">
            <Panel title="Returned value by reason" sub={c}>
              <RankBars cur={c} data={[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([label, v]) => ({ label, value: v }))} />
            </Panel>
            <Panel title="Most returned items">
              <DataTable maxHeight={360} exportName={`Returned items ${s.company}`} rows={items}
                cols={[{ key: "item", label: "Item" }, { key: "lines", label: "Lines", type: "int" }, { key: "qty", label: "Qty", type: "num" },
                  { key: "value", label: `Value (${c})`, type: "money" }, { key: "disposition", label: "Disposition codes" }]} />
            </Panel>
          </div>
          <Panel title="Return orders">
            <DataTable exportName={`Return orders ${s.company}`} rows={orders}
              cols={[{ key: "return_order", label: "Return order" }, { key: "rma", label: "RMA" }, { key: "customer", label: "Account" }, { key: "name", label: "Customer" },
                { key: "reason", label: "Reason" }, { key: "status", label: "Status" }, { key: "deadline", label: "Deadline", type: "date" },
                { key: "lines", label: "Lines", type: "int" }, { key: "qty", label: "Qty", type: "num" }, { key: "total", label: `Value (${c})`, type: "money" },
                { key: "replacement_order", label: "Replacement" }]} />
          </Panel>
        </>
      )}
    </>
  );
}
