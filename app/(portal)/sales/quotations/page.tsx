import { reportScope, today } from "@/lib/page";
import { quotations } from "@/lib/reports/sales";
import { money, fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const rows = await quotations(s);
  const c = s.currency;
  const val = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + Number(r.total), 0);
  const won = val((r) => r.status === 2), lost = val((r) => r.status === 3);
  const openF = (r: (typeof rows)[number]) => [0, 1, 5, 6, 7, 8, 9].includes(r.status);
  const t = today();
  const expiring = rows.filter((r) => openF(r) && r.expiry && String(r.expiry).slice(0, 10) >= t && Date.parse(String(r.expiry)) - Date.parse(t) <= 7 * 86400000);

  return (
    <>
      <PageHead title="Quotations" sub="Sales quotations by status, with open pipeline and win rate" />
      <Filters s={s} show={{ period: false }} />
      <KpiRow>
        <Kpi label="Quotations" value={fmt(rows.length)} note={`${money(val(() => true), c)} quoted`} />
        <Kpi label="Open pipeline" value={money(val(openF), c)} note={`${fmt(rows.filter(openF).length)} open`} />
        <Kpi label="Won" value={money(won, c)} note="confirmed into orders" tone={won ? "good" : null} />
        <Kpi label="Lost" value={money(lost, c)} tone={lost ? "bad" : null} />
        <Kpi label="Win rate" value={won + lost ? `${((won / (won + lost)) * 100).toFixed(0)}%` : "–"} note="won ÷ (won + lost), by value" />
        <Kpi label="Expiring in 7 days" value={fmt(expiring.length)} tone={expiring.length ? "warn" : null} />
      </KpiRow>
      <Panel title="All quotations">
        <DataTable exportName={`Quotations ${s.company}`} rows={rows}
          cols={[{ key: "quotation", label: "Quotation" }, { key: "customer", label: "Customer / prospect" }, { key: "name", label: "Name" },
            { key: "status_label", label: "Status" }, { key: "requested_date", label: "Requested", type: "date" }, { key: "expiry", label: "Expires", type: "date" },
            { key: "lines", label: "Lines", type: "int" }, { key: "total", label: `Value (${c})`, type: "money" }, { key: "sales_order", label: "Sales order" },
            { key: "responsible_name", label: "Responsible" }]}
          empty={`No quotations in ${s.company.toUpperCase()} for ${c}.`} />
      </Panel>
    </>
  );
}
