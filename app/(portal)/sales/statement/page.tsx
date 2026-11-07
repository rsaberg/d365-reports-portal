import Link from "next/link";
import { reportScope, one } from "@/lib/page";
import { qs } from "@/lib/filters";
import { statementSummary, statementLines, collectionsByMonth } from "@/lib/reports/sales";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { PairBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const cust = one(searchParams.customer);
  const [rows, months, detail] = await Promise.all([statementSummary(s), collectionsByMonth(s), cust ? statementLines(s, cust) : null]);
  const mst = s.mst;
  const t = (k: "opening" | "invoiced" | "collected" | "other" | "closing") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const opening = t("opening"), invoiced = t("invoiced"), collected = t("collected"), closing = t("closing");
  // Collection effectiveness: share of what was collectible (opening + invoiced) that was collected.
  const cei = opening + invoiced > 0 ? collected / (opening + invoiced) : null;
  const sel = cust ? rows.find((r) => r.account === cust) : null;

  return (
    <>
      <PageHead title="Statement & Collections" sub={<>Customer ledger movements · {dateFmt(s.from)} – {dateFmt(s.to)} · {mst} (accounting currency)</>} />
      <Filters s={s} show={{ currency: false }} />
      <KpiRow>
        <Kpi label="Opening balance" value={money(opening, mst)} note={`before ${dateFmt(s.from)}`} />
        <Kpi label="Invoiced" value={money(invoiced, mst)} note="sales, project and free-text invoices" />
        <Kpi label="Collected" value={money(collected, mst)} note="customer payments" tone="good" />
        <Kpi label="Other movements" value={money(t("other"), mst)} note="journals, write-offs, discounts" />
        <Kpi label="Closing balance" value={money(closing, mst)} note={`at ${dateFmt(s.to)}`} />
        <Kpi label="Collection rate" value={cei === null ? "–" : `${(cei * 100).toFixed(0)}%`} note="collected ÷ (opening + invoiced)" tone={cei === null ? null : cei >= 0.8 ? "good" : "warn"} />
      </KpiRow>
      <Panel title="Invoiced vs collected by month" sub={mst} className="mb-4">
        <PairBars cur={mst} a={{ key: "invoiced", name: "Invoiced" }} b={{ key: "collected", name: "Collected" }}
          data={months.map((m) => ({ ...m, label: `${MONTHS[Number(m.m.slice(5)) - 1]} ${m.m.slice(2, 4)}` }))} />
      </Panel>
      {cust && detail && (
        <Panel className="mb-4" title={`Statement · ${cust} ${sel?.name ?? ""}`} sub={`opening ${money(detail.opening, mst)} · closing ${money(detail.opening + detail.rows.reduce((a, r) => a + Number(r.amount), 0), mst)}`}
          action={<Link className="text-[12px] text-accent hover:underline" href={`?${qs(s)}`}>Close</Link>}>
          <DataTable maxHeight={420} exportName={`Statement ${cust} ${s.from} ${s.to}`} rows={detail.rows}
            cols={[{ key: "trans_date", label: "Date", type: "date" }, { key: "voucher", label: "Voucher" }, { key: "invoice", label: "Invoice" },
              { key: "type", label: "Type" }, { key: "txt", label: "Description" }, { key: "due_date", label: "Due", type: "date" },
              { key: "debit", label: "Debit", type: "money" }, { key: "credit", label: "Credit", type: "money" }, { key: "balance", label: "Balance", type: "money" },
              { key: "closed", label: "Settled on", type: "date" }]}
            empty="No transactions for this customer in the period." />
        </Panel>
      )}
      <Panel title="Statement summary by customer" sub="click an account to open its statement">
        <DataTable exportName={`Statement summary ${s.company} ${s.from} ${s.to}`} rows={rows}
          cols={[{ key: "account", label: "Account", href: `?${qs(s)}&customer={account}` }, { key: "name", label: "Customer" },
            { key: "opening", label: "Opening", type: "money" }, { key: "invoiced", label: "Invoiced", type: "money" }, { key: "collected", label: "Collected", type: "money" },
            { key: "other", label: "Other", type: "money" }, { key: "closing", label: "Closing", type: "money" }, { key: "last_payment", label: "Last payment", type: "date" }]}
          total={{ account: "Total", opening, invoiced, collected, other: t("other"), closing }} />
        <p className="text-[12px] text-muted mt-2">Closing = opening + invoiced − collected + other. {fmt(rows.length)} customers.</p>
      </Panel>
    </>
  );
}
