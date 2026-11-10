import Link from "next/link";
import { reportScope, one, today } from "@/lib/page";
import { documentTypes, documentRows } from "@/lib/reports/ops";
import { fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty, Tabs } from "@/components/ui";
import DataTable, { type Col } from "@/components/DataTable";
import { OpsNote } from "../shared";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  if (s.user.role === "sales") return <Empty>Transaction tracking is open to administrators and managers.</Empty>;
  const types = (await documentTypes(s.company)).filter((t) => t.total > 0);
  if (!types.length) return <Empty>No documents synced for {s.company.toUpperCase()} yet.</Empty>;
  const t = types.find((x) => x.key === one(searchParams.type)) ?? types[0];
  const show = one(searchParams.show) === "open" ? "open" : one(searchParams.show) === "posted" ? "posted" : "all";
  const stageSel = one(searchParams.stage);
  const all = await documentRows(s.company, t.key, today());
  const rows = all.filter((r) => (show === "open" ? !r.posted && r.stage !== "Cancelled" : show === "posted" ? r.posted : true))
    .filter((r) => !stageSel || r.stage === stageSel);
  const q = (x: Record<string, string>) => new URLSearchParams({ company: s.company, type: t.key, ...(show !== "all" ? { show } : {}), ...x }).toString();
  const isJournal = t.key.startsWith("j:");
  const stages = [...new Map(all.map((r) => [r.stage, 0])).keys()].map((st) => ({ label: st, value: all.filter((r) => r.stage === st).length }));

  const cols: Col[] = [
    { key: "doc", label: isJournal ? "Journal" : "Number" },
    { key: "date", label: isJournal ? "Posted on" : t.key === "prod" ? "Delivery date" : t.key === "to" ? "Ship date" : "Date", type: "date" },
    { key: "party", label: isJournal ? "Journal name" : t.key === "so" ? "Customer" : t.key === "po" ? "Vendor" : t.key === "prod" ? "Item" : "From → to" },
    { key: "stage", label: "Stage" }, { key: "posted_flag", label: t.postedLabel },
    ...(t.key === "prod" || t.key === "to" ? [] : [{ key: "user", label: isJournal ? "Posted by" : t.key === "po" ? "Orderer" : "Order taker" }]),
    ...(t.key === "so" ? [{ key: "amount", label: "Invoiced amount", type: "money" as const }] : t.key === "prod" ? [{ key: "amount", label: "Quantity", type: "num" as const }] : t.key.includes("Ledger") ? [{ key: "amount", label: "Total debit", type: "money" as const }] : []),
    { key: "age", label: "Waiting (days)", type: "int", tone: "badIfPositive" }, { key: "extra", label: isJournal ? "Description" : "Note", wrap: true },
  ];

  return (
    <>
      <PageHead title={`${t.name} – lifecycle`} sub={<>{s.company.toUpperCase()} · {t.module} · <Link className="link" href={`/ops?company=${s.company}`}>All modules</Link></>} />
      <Filters s={s} show={{ period: false, currency: false, group: false }} />
      <Tabs active={t.key} items={types.map((x) => ({ key: x.key, label: x.name, href: `?${new URLSearchParams({ company: s.company, type: x.key })}` }))} />
      <KpiRow>
        <Kpi label="Total" value={fmt(t.total)} />
        <Kpi label={t.postedLabel} value={fmt(t.posted)} note={t.total ? `${((t.posted / t.total) * 100).toFixed(0)}%` : undefined} tone="good" href={`?${q({ show: "posted" })}`} />
        <Kpi label="Not posted" value={fmt(t.open)} tone={t.open ? "warn" : "good"} href={`?${q({ show: "open" })}`} />
        <Kpi label="Cancelled" value={fmt(t.cancelled)} />
        <Kpi label="Waiting > 30 days" value={fmt(all.filter((r) => !r.posted && (r.age ?? 0) > 30).length)} tone="bad" />
        <Kpi label="Oldest open" value={(() => { const a = Math.max(-1, ...all.filter((r) => !r.posted && r.age !== null).map((r) => r.age!)); return a >= 0 ? `${fmt(a)} d` : "–"; })()} />
      </KpiRow>
      <section className="grid lg:grid-cols-2 gap-4 mb-4">
        <Panel title="Stages" sub="from created to posted">
          <div className="grid gap-1.5">
            {t.stages.filter((st) => st.n > 0 || st.done).map((st) => {
              const max = Math.max(1, ...t.stages.map((x) => x.n));
              return (
                <div key={st.label} className="grid grid-cols-[170px_1fr_56px] items-center gap-2 text-[13px]">
                  <span className={st.done ? "font-semibold" : ""}>{st.label}</span>
                  <div className="h-3 rounded bg-sunken overflow-hidden"><div className={`h-full ${st.done ? "bg-good" : st.label.startsWith("Cancel") || st.label === "Rejected" ? "bg-muted/40" : "bg-warn"}`} style={{ width: `${(st.n / max) * 100}%` }} /></div>
                  <span className="num text-right">{fmt(st.n)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Filter by current stage" sub="number of documents at each stage">
          <div className="flex flex-wrap gap-1.5">
            {stages.map((st) => <Link key={st.label} className={`btn !py-0.5 !min-h-0 text-[12px] ${stageSel === st.label ? "btn-primary" : ""}`} href={`?${q(stageSel === st.label ? {} : { stage: st.label })}`}>{st.label} · {st.value}</Link>)}
          </div>
        </Panel>
      </section>
      <Panel title={`${t.name}${show === "open" ? " – not posted" : show === "posted" ? ` – ${t.postedLabel.toLowerCase()}` : ""}${stageSel ? ` · ${stageSel}` : ""}`}
        action={<span className="flex gap-2 text-[12px]">{(["all", "open", "posted"] as const).map((v) => <Link key={v} className={`link ${show === v ? "font-semibold" : ""}`} href={`?${new URLSearchParams({ company: s.company, type: t.key, ...(v !== "all" ? { show: v } : {}) })}`}>{v === "all" ? "All" : v === "open" ? "Not posted" : t.postedLabel}</Link>)}</span>}>
        <DataTable exportName={`${t.name} ${s.company}`} cols={cols} rows={rows.map((r) => ({ ...r, posted_flag: r.posted ? "Yes" : "No" }))} />
      </Panel>
      <OpsNote />
    </>
  );
}
