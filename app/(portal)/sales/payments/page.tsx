import Link from "next/link";
import { reportScope, one, today } from "@/lib/page";
import { qs } from "@/lib/filters";
import { invoicePayments } from "@/lib/reports/ops";
import { TRANS_TYPE_LABEL } from "@/lib/d365/entities";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { BucketBars } from "@/components/charts";
import DataTable from "@/components/DataTable";
import AsOf from "@/components/AsOf";

export const dynamic = "force-dynamic";
const STATUSES = ["Unpaid", "Partially paid", "Paid"] as const;
const BUCKETS = [{ label: "Not due", lo: -1e9, hi: 0 }, { label: "1–30", lo: 1, hi: 30 }, { label: "31–60", lo: 31, hi: 60 }, { label: "61–90", lo: 61, hi: 90 },
  { label: "91–180", lo: 91, hi: 180 }, { label: "181–365", lo: 181, hi: 365 }, { label: "Over 1 year", lo: 366, hi: 1e9 }];

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(one(searchParams.asof) ?? "") ? one(searchParams.asof)! : today();
  const status = STATUSES.find((x) => x === one(searchParams.status));
  const cust = one(searchParams.customer);
  const all = (await invoicePayments(s, asOf)).filter((r) => !cust || r.account === cust);
  const rows = all.filter((r) => !status || r.status === status).map((r) => ({ ...r, kind: TRANS_TYPE_LABEL[r.type] ?? r.type,
    on_time: r.status === "Paid" ? ((r.late_days ?? 0) <= 0 ? "On time" : `${r.late_days} days late`) : (r.days_overdue ?? 0) > 0 ? `Overdue ${r.days_overdue} d` : "Not due" }));
  const sum = (f: (r: (typeof all)[number]) => boolean, k: "amount" | "paid" | "remaining") => all.filter(f).reduce((a, r) => a + r[k], 0);
  const total = sum(() => true, "amount"), paid = sum(() => true, "paid"), remaining = sum(() => true, "remaining");
  const paidRows = all.filter((r) => r.status === "Paid" && r.days_to_pay !== null);
  const avgDays = paidRows.length ? paidRows.reduce((a, r) => a + r.days_to_pay!, 0) / paidRows.length : null;
  const onTime = paidRows.length ? paidRows.filter((r) => (r.late_days ?? 0) <= 0).length / paidRows.length : null;
  const overdue = all.filter((r) => r.status !== "Paid" && (r.days_overdue ?? 0) > 0);
  const bucketData = BUCKETS.map((b, i) => ({ label: b.label, value: all.filter((r) => r.status !== "Paid" && (r.days_overdue ?? 0) >= b.lo && (r.days_overdue ?? 0) <= b.hi).reduce((a, r) => a + r.remaining, 0),
    color: i === 0 ? "var(--c1)" : `hsl(16 72% ${70 - ((i - 1) / (BUCKETS.length - 2)) * 42}%)` }));
  const link = (x: Record<string, string>) => `?${qs(s, { asof: asOf, ...(cust ? { customer: cust } : {}), ...x })}`;
  const count = (st: string) => all.filter((r) => r.status === st).length;
  const mst = s.mst;

  return (
    <>
      <PageHead title="Invoice payment status" sub={<>Every customer invoice dated {dateFmt(s.from)} – {dateFmt(s.to)}: what was paid, what is left and how many days · {mst} · as of {dateFmt(asOf)}{cust ? <> · customer {cust} · <Link className="link" href={link({ customer: "" }).replace("&customer=", "")}>all customers</Link></> : null}</>} />
      <Filters s={s} show={{ currency: false }} extra={<AsOf value={asOf} label="Status as of" />} />
      <KpiRow>
        <Kpi label="Invoiced" value={money(total, mst)} note={`${fmt(all.length)} invoices`} href={link({})} />
        <Kpi label="Paid" value={money(paid, mst)} note={`${fmt(count("Paid"))} fully paid · ${total ? ((paid / total) * 100).toFixed(0) : 0}%`} tone="good" href={link({ status: "Paid" })} />
        <Kpi label="Remaining" value={money(remaining, mst)} note={`${fmt(count("Unpaid"))} unpaid · ${fmt(count("Partially paid"))} partial`} tone={remaining > 0 ? "warn" : "good"} href={link({ status: "Unpaid" })} />
        <Kpi label="Overdue" value={money(overdue.reduce((a, r) => a + r.remaining, 0), mst)} note={`${fmt(overdue.length)} invoices past due`} tone={overdue.length ? "bad" : "good"} />
        <Kpi label="Avg. days to pay" value={avgDays === null ? "–" : `${avgDays.toFixed(0)} d`} note="invoice date → last payment" />
        <Kpi label="Paid on time" value={onTime === null ? "–" : `${(onTime * 100).toFixed(0)}%`} note="settled by the due date" tone={onTime !== null && onTime < 0.7 ? "bad" : "good"} />
      </KpiRow>
      <section className="grid xl:grid-cols-2 gap-4 mb-4">
        <Panel title="Remaining amount by days overdue" sub={`${mst} · unpaid and partially paid invoices`}>
          <BucketBars cur={mst} data={bucketData} />
        </Panel>
        <Panel title="By status">
          <div className="overflow-auto border border-line rounded-lg">
          <table className="dtable">
            <thead><tr><th>Status</th><th className="r">Invoices</th><th className="r">Amount</th><th className="r">Paid</th><th className="r">Remaining</th></tr></thead>
            <tbody>
              {STATUSES.map((st) => (
                <tr key={st}>
                  <td><Link className="text-accent hover:underline" href={link({ status: st })}>{st}</Link></td>
                  <td className="r num">{fmt(count(st))}</td>
                  <td className="r num">{fmt(sum((r) => r.status === st, "amount"), 2)}</td>
                  <td className="r num">{fmt(sum((r) => r.status === st, "paid"), 2)}</td>
                  <td className="r num">{fmt(sum((r) => r.status === st, "remaining"), 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="font-semibold"><td>Total</td><td className="r num">{fmt(all.length)}</td><td className="r num">{fmt(total, 2)}</td><td className="r num">{fmt(paid, 2)}</td><td className="r num">{fmt(remaining, 2)}</td></tr></tfoot>
          </table>
          </div>
        </Panel>
      </section>
      <Panel title={`Invoices${status ? ` – ${status.toLowerCase()}` : ""}`}
        action={<span className="flex gap-3 text-[12px]">{["All", ...STATUSES].map((st) => <Link key={st} className={`link ${(status ?? "All") === st ? "font-semibold" : ""}`} href={link(st === "All" ? {} : { status: st })}>{st}</Link>)}</span>}>
        <DataTable exportName={`Invoice payments ${s.company} ${asOf}`} rows={rows}
          cols={[{ key: "invoice", label: "Invoice" }, { key: "kind", label: "Type" }, { key: "account", label: "Account", href: `${link({})}&customer={account}` }, { key: "name", label: "Customer" },
            { key: "trans_date", label: "Invoice date", type: "date" }, { key: "due_date", label: "Due date", type: "date" },
            { key: "amount", label: "Amount", type: "money" }, { key: "paid", label: "Paid", type: "money" }, { key: "remaining", label: "Remaining", type: "money", tone: "badIfPositive" },
            { key: "status", label: "Status" }, { key: "last_settle", label: "Paid on", type: "date" }, { key: "days_to_pay", label: "Days to pay", type: "int" },
            { key: "days_overdue", label: "Days overdue", type: "int", tone: "badIfPositive" }, { key: "on_time", label: "Timing" }]}
          total={{ invoice: "Total", amount: rows.reduce((a, r) => a + r.amount, 0), paid: rows.reduce((a, r) => a + r.paid, 0), remaining: rows.reduce((a, r) => a + r.remaining, 0) }} />
      </Panel>
      <p className="text-[12px] text-muted mt-4 max-w-3xl">
        Source: customer transactions (sales, free-text and project invoices) with their settled amount. &quot;Paid on&quot; is the last settlement date, so an invoice
        closed by a credit note also counts as paid. Vendor invoices need the vendor transactions entity (custom) to appear in the same way.
      </p>
    </>
  );
}
