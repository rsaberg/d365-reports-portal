import Link from "next/link";
import { reportScope, one, today } from "@/lib/page";
import { qs } from "@/lib/filters";
import { agingItems, TRANS_TYPE_LABEL } from "@/lib/reports/sales";
import { agingSettings, agingBuckets, bucketIndex } from "@/lib/buckets";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { BucketBars } from "@/components/charts";
import DataTable, { Col } from "@/components/DataTable";
import AsOf from "@/components/AsOf";
import Basis from "@/components/Basis";

export const dynamic = "force-dynamic";
const DAY = 86400000;

/** Overdue buckets get a single-hue ramp, lighter to darker with age; "Not due" keeps the series blue. */
const rampColor = (i: number, n: number) => (i === 0 ? "var(--c1)" : `hsl(16 72% ${70 - ((i - 1) / Math.max(1, n - 2)) * 42}%)`);

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const settings = await agingSettings();
  const basis = one(searchParams.basis) === "trans" ? "trans" : one(searchParams.basis) === "due" ? "due" : settings.basis;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.asof) ?? "") ? one(searchParams.asof)! : today();
  const defs = agingBuckets(settings.limits);
  const items = (await agingItems(s)).map((r) => {
    const ref = basis === "due" ? r.due_date : r.trans_date;
    const days = Math.round((Date.parse(asOf) - Date.parse(String(ref).slice(0, 10))) / DAY);
    return { ...r, days, b: bucketIndex(days, defs) };
  });
  const mst = s.mst;

  type Row = { account: string; name: string; cust_group: string; credit_limit: number; payment_terms: string; total: number; over: boolean; [k: string]: any };
  const map = new Map<string, Row>();
  for (const r of items) {
    const row = map.get(r.account) ?? { account: r.account, name: r.name, cust_group: r.cust_group, credit_limit: Number(r.credit_limit), payment_terms: r.payment_terms, total: 0, over: false, ...Object.fromEntries(defs.map((_, i) => [`b${i}`, 0])) };
    row[`b${r.b}`] += Number(r.open); row.total += Number(r.open); map.set(r.account, row);
  }
  const rows: Row[] = [...map.values()].map((r) => ({ ...r, over: r.credit_limit > 0 && r.total > r.credit_limit, limit_flag: r.credit_limit > 0 && r.total > r.credit_limit ? "Over limit" : "" }))
    .filter((r) => Math.abs(r.total) > 0.005).sort((a, b) => b.total - a.total);
  const totals = defs.map((_, i) => rows.reduce((a, r) => a + r[`b${i}`], 0));
  const total = totals.reduce((a, b) => a + b, 0);
  const notDue = totals[0];
  const over90 = totals.reduce((a, v, i) => a + (defs[i].lo > 90 ? v : 0), 0);
  const unapplied = items.filter((r) => Number(r.open) < 0).reduce((a, r) => a + Number(r.open), 0);
  const cust = one(searchParams.customer);
  const custItems = cust ? items.filter((r) => r.account === cust).sort((a, b) => b.days - a.days) : null;

  const cols: Col[] = [
    { key: "account", label: "Account", href: `?${qs(s, { asof: asOf, basis })}&customer={account}` }, { key: "name", label: "Customer" },
    { key: "cust_group", label: "Group" }, { key: "credit_limit", label: "Credit limit", type: "money" },
    ...defs.map((d, i) => ({ key: `b${i}`, label: d.label, type: "money" as const })),
    { key: "total", label: `Total (${mst})`, type: "money" }, { key: "limit_flag", label: "Credit" },
  ];

  return (
    <>
      <PageHead title="Customer Aging" sub={<>Open customer transactions by days past {basis === "due" ? "due date" : "transaction date"} · aged as of {dateFmt(asOf)} · {mst} (accounting currency)</>} />
      <Filters s={s} show={{ period: false, currency: false }} extra={<><AsOf value={asOf} label="Aging date" /><Basis value={basis} /></>} />
      <KpiRow>
        <Kpi label="Total receivables" value={money(total, mst)} note={`${fmt(rows.length)} customers with a balance`} />
        <Kpi label="Not yet due" value={money(notDue, mst)} note={total ? `${((notDue / total) * 100).toFixed(0)}% of total` : undefined} />
        <Kpi label="Overdue" value={money(total - notDue, mst)} note={total ? `${(((total - notDue) / total) * 100).toFixed(0)}% of total` : undefined} tone={total - notDue > 0 ? "bad" : "good"} />
        <Kpi label="Over 90 days" value={money(over90, mst)} note="provision risk" tone={over90 > 0 ? "bad" : null} />
        <Kpi label="Unapplied credits" value={money(unapplied, mst)} note="payments & credit notes not yet settled" />
        <Kpi label="Over credit limit" value={fmt(rows.filter((r) => r.over).length)} note="customers" tone={rows.some((r) => r.over) ? "bad" : null} />
      </KpiRow>
      <Panel title="Receivables by aging bucket" sub={`${mst} · bucket limits are set in Settings`} className="mb-4">
        <BucketBars cur={mst} data={defs.map((d, i) => ({ label: d.label, value: totals[i], color: rampColor(i, defs.length) }))} />
      </Panel>
      {custItems && (
        <Panel className="mb-4" title={`Open items · ${cust} ${custItems[0]?.name ?? ""}`}
          action={<span className="flex gap-3 text-[12px]"><Link className="text-accent hover:underline" href={`/sales/statement?${qs(s)}&customer=${encodeURIComponent(cust!)}`}>Statement</Link><Link className="text-accent hover:underline" href={`?${qs(s, { asof: asOf, basis })}`}>Close</Link></span>}>
          <DataTable maxHeight={320} exportName={`Open items ${cust}`} rows={custItems.map((r) => ({ ...r, type: TRANS_TYPE_LABEL[r.trans_type] ?? r.trans_type, bucket: defs[r.b].label }))}
            cols={[{ key: "voucher", label: "Voucher" }, { key: "invoice", label: "Invoice" }, { key: "type", label: "Type" }, { key: "trans_date", label: "Date", type: "date" },
              { key: "due_date", label: "Due", type: "date" }, { key: "days", label: "Days", type: "int", tone: "badIfPositive" }, { key: "bucket", label: "Bucket" },
              { key: "open", label: `Open (${mst})`, type: "money" }]} />
        </Panel>
      )}
      <Panel title="Aging by customer" sub="click an account to see its open items">
        <DataTable exportName={`Customer aging ${s.company} ${asOf}`} cols={cols} rows={rows}
          total={{ account: "Total", total, ...Object.fromEntries(totals.map((v, i) => [`b${i}`, v])) }} />
      </Panel>
    </>
  );
}
