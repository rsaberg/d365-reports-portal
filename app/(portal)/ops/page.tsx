import Link from "next/link";
import { reportScope, today } from "@/lib/page";
import { documentTypes, documentRows, type DocRow } from "@/lib/reports/ops";
import { fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import DataTable from "@/components/DataTable";
import { OpsNote } from "./shared";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  if (s.user.role === "sales") return <Empty>Transaction tracking is open to administrators and managers.</Empty>;
  const types = (await documentTypes(s.company)).filter((t) => t.total > 0);
  const asOf = today();
  const total = types.reduce((a, t) => a + t.total, 0);
  const posted = types.reduce((a, t) => a + t.posted, 0);
  const open = types.reduce((a, t) => a + t.open, 0);
  // Everything not yet posted, across modules, for the action list.
  // Documents still waiting, one type at a time (sequential queries keep the page on one pooled connection).
  const pending: (DocRow & { module: string; type: string; key: string })[] = [];
  for (const t of types) {
    for (const r of await documentRows(s.company, t.key, asOf)) if (!r.posted && r.stage !== "Cancelled") pending.push({ ...r, module: t.module, type: t.name.replace(/s$/, ""), key: t.key });
  }
  pending.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  const modules = [...new Set(types.map((t) => t.module))];
  const q = `company=${s.company}`;

  return (
    <>
      <PageHead title="Transaction tracking" sub={<>{s.company.toUpperCase()} · what was created, what was posted and what is still waiting, by module</>} />
      <Filters s={s} show={{ period: false, currency: false, group: false }} />
      <KpiRow>
        <Kpi label="Documents & journals" value={fmt(total)} note={`${types.length} document types`} />
        <Kpi label="Posted / completed" value={fmt(posted)} note={total ? `${((posted / total) * 100).toFixed(0)}%` : undefined} tone="good" />
        <Kpi label="Not posted" value={fmt(open)} note="open orders and unposted journals" tone={open ? "warn" : "good"} />
        <Kpi label="Unposted journals" value={fmt(types.filter((t) => t.key.startsWith("j:")).reduce((a, t) => a + t.open, 0))} tone="warn" />
        <Kpi label="Open > 30 days" value={fmt(pending.filter((p) => (p.age ?? 0) > 30).length)} note="dated documents only" tone="bad" />
        <Kpi label="Modules" value={fmt(modules.length)} />
      </KpiRow>

      <Panel title="Posted vs not posted by module" sub="click a document type for its stages and documents" className="mb-4">
        <div className="overflow-auto border border-line rounded-lg">
          <table className="dtable">
            <thead><tr><th>Module</th><th>Document</th><th className="r">Total</th><th className="r">Posted</th><th className="r">Not posted</th><th className="r">Cancelled</th><th>Posted means</th><th className="min-w-[160px]">Progress</th></tr></thead>
            <tbody>
              {types.map((t) => {
                const pct = t.total ? t.posted / t.total : 0;
                return (
                  <tr key={t.key}>
                    <td>{t.module}</td>
                    <td><Link className="text-accent hover:underline" href={`/ops/documents?${q}&type=${encodeURIComponent(t.key)}`}>{t.name}</Link></td>
                    <td className="r num">{fmt(t.total)}</td>
                    <td className="r num text-good">{fmt(t.posted)}</td>
                    <td className="r num">{t.open ? <Link className="text-warn font-semibold hover:underline" href={`/ops/documents?${q}&type=${encodeURIComponent(t.key)}&show=open`}>{fmt(t.open)}</Link> : "0"}</td>
                    <td className="r num">{t.cancelled ? fmt(t.cancelled) : "–"}</td>
                    <td className="text-muted">{t.postedLabel}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-sunken overflow-hidden"><div className="h-full bg-good" style={{ width: `${pct * 100}%` }} /></div>
                        <span className="num text-[12px] w-10 text-right">{(pct * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Waiting to be posted" sub="oldest first · age = days since the document date">
        <DataTable exportName={`Not posted ${s.company}`} maxHeight={480}
          rows={pending.map((p) => ({ ...p, flag: (p.age ?? 0) > 30 ? "Over 30 days" : "" }))}
          cols={[{ key: "module", label: "Module" }, { key: "type", label: "Document" }, { key: "doc", label: "Number", href: "/ops/documents?company=" + s.company + "&type={key}&show=open" },
            { key: "date", label: "Date", type: "date" }, { key: "party", label: "Customer / vendor / item" }, { key: "stage", label: "Stage" },
            { key: "user", label: "User" }, { key: "age", label: "Age (days)", type: "int", tone: "badIfPositive" }, { key: "extra", label: "Note", wrap: true }]} />
      </Panel>
      <OpsNote />
    </>
  );
}
