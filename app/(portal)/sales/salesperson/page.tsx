import Link from "next/link";
import { reportScope } from "@/lib/page";
import { bySalesperson, salespersonMonthly } from "@/lib/reports/sales";
import { money, fmt, dateFmt, pctFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { PairBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const [rows, months] = await Promise.all([bySalesperson(s), salespersonMonthly(s)]);
  const c = s.currency;
  const net = rows.reduce((a, r) => a + Number(r.net), 0);
  const target = rows.reduce((a, r) => a + Number(r.target), 0);
  const prev = rows.reduce((a, r) => a + Number(r.prev), 0);
  const best = [...rows].filter((r) => r.target > 0).sort((a, b) => b.net / b.target - a.net / a.target)[0];
  const data = rows.map((r) => ({ ...r, achievement: r.target ? r.net / r.target : null, growth: r.prev ? (r.net - r.prev) / Math.abs(r.prev) : null,
    disc_pct: r.net + r.discount ? r.discount / (r.net + r.discount) : 0, avg_invoice: r.invoices ? r.net / r.invoices : 0 }));

  return (
    <>
      <PageHead title="Sales by Salesperson" sub={<>Invoiced net sales by the sales order&apos;s responsible person · {dateFmt(s.from)} – {dateFmt(s.to)}</>}
        actions={s.user.role === "admin" ? <Link className="btn" href={`/admin/targets?company=${s.company}`}>Edit targets</Link> : undefined} />
      <Filters s={s} />
      <KpiRow>
        <Kpi label="Net sales" value={money(net, c)} note={`${fmt(rows.length)} ${rows.length === 1 ? "salesperson" : "salespeople"}`} />
        <Kpi label="Target" value={target ? money(target, c) : "Not set"} note={target ? "for the selected months" : "add targets in Administration"} />
        <Kpi label="Achievement" value={target ? `${((net / target) * 100).toFixed(0)}%` : "–"} tone={!target ? null : net >= target ? "good" : "bad"}
          note={target ? (net >= target ? `${money(net - target, c)} above target` : `${money(target - net, c)} short`) : undefined} />
        <Kpi label="Growth" value={pctFmt(prev ? (net - prev) / Math.abs(prev) : null)} note="vs same period last year" />
        <Kpi label="Best vs target" value={best ? best.name : "–"} note={best ? `${((best.net / best.target) * 100).toFixed(0)}% of target` : undefined} tone={best ? "good" : null} />
        <Kpi label="Unassigned sales" value={money(rows.filter((r) => !r.responsible).reduce((a, r) => a + Number(r.net), 0), c)} note="invoices without a responsible person" />
      </KpiRow>
      <Panel title="Actual vs target by month" sub={c} className="mb-4">
        <PairBars cur={c} a={{ key: "target", name: "Target" }} b={{ key: "net", name: "Actual" }}
          data={months.map((m) => ({ ...m, label: `${MONTHS[Number(m.m.slice(5)) - 1]} ${m.m.slice(2, 4)}` }))} />
      </Panel>
      <Panel title="Salesperson scorecard">
        <DataTable exportName={`Sales by salesperson ${s.company} ${s.from} ${s.to}`} rows={data}
          cols={[{ key: "responsible", label: "Personnel no." }, { key: "name", label: "Salesperson" }, { key: "customers", label: "Customers", type: "int" },
            { key: "invoices", label: "Invoices", type: "int" }, { key: "net", label: `Net sales (${c})`, type: "money" }, { key: "target", label: "Target", type: "money" },
            { key: "achievement", label: "Achievement", type: "pct" }, { key: "growth", label: "vs LY", type: "pct", tone: "signed" },
            { key: "avg_invoice", label: "Avg invoice", type: "money" }, { key: "disc_pct", label: "Discount %", type: "pct" }]}
          total={{ responsible: "Total", net, target }} />
      </Panel>
    </>
  );
}
