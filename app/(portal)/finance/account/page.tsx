import Link from "next/link";
import { accountDetail, finQs, finScope, mLabel } from "@/lib/gl/fin";
import { sql } from "@/lib/db";
import { FinHead, NoFinance } from "@/components/FinShell";
import { Panel, Empty, Tabs } from "@/components/ui";
import DataTable, { type Col } from "@/components/DataTable";
import { RankBars } from "@/components/charts";
import { dateFmt, fmt } from "@/lib/format";

export const dynamic = "force-dynamic";
const nice = (d: string) => d.charAt(0) + d.slice(1).toLowerCase().replace(/_/g, " ");
const PT: Record<string, string> = { O: "", P: "Opening", C: "Closing" };

export default async function AccountDrill({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope(searchParams);
  if (!f) return <NoFinance />;
  const account = String(searchParams.a ?? "");
  const [acc] = await sql<{ account: string; name: string; type: string }[]>`select account, name, type from gl.accounts where account = ${account}`;
  if (!acc) return <Empty>Account not found. <Link className="link" href={`/finance/trial?${finQs(f)}`}>Trial balance</Link></Empty>;
  const by = typeof searchParams.by === "string" && f.dims.includes(searchParams.by) ? searchParams.by : f.dims[0] ?? null;
  const page = Math.max(0, Number(searchParams.page) || 0);
  const d = await accountDetail(f, account, f.fromM, f.toM, by, page);
  const qs = finQs(f, { a: account });

  let run = d.tb.op;
  const months = d.months.map((m) => { run += m.dr - m.cr; return { m: mLabel(m.m), dr: m.dr, cr: m.cr, net: m.dr - m.cr, bal: run }; });
  const mcols: Col[] = [{ key: "m", label: "Month" }, { key: "dr", label: "Debit", type: "money" }, { key: "cr", label: "Credit", type: "money" }, { key: "net", label: "Net", type: "money", tone: "signed" }, ...(d.pl ? [] : [{ key: "bal", label: "Balance", type: "money" as const }])];
  const vcols: Col[] = [
    { key: "date", label: "Date", type: "date" }, ...(f.consolidated ? [{ key: "co", label: "Company" }] : []),
    { key: "voucher", label: "Voucher", href: `/finance/voucher?id={hdr}&${finQs(f)}` }, { key: "pt", label: "Type" },
    { key: "category", label: "Category" }, { key: "journal", label: "Journal" }, { key: "doc", label: "Document" },
    { key: "dimsTxt", label: "Dimensions", wrap: true }, { key: "v", label: "Amount", type: "money", tone: "signed" },
  ];
  const vrows = d.vouchers.map((v) => ({ ...v, date: v.acc_date, co: v.company.toUpperCase(), pt: PT[v.ptype] ?? v.ptype,
    dimsTxt: v.dims ? Object.entries(v.dims).map(([k, x]) => `${nice(k)}: ${x}`).join(" · ") : "" }));
  return (
    <>
      <FinHead f={f} title={`${acc.account} · ${acc.name}`} sub={<><Link className="link" href={`/finance/${d.pl ? "income" : "balance"}?${finQs(f)}`}>{d.pl ? "Income statement" : "Balance sheet"}</Link> account · {acc.type} · {f.currency}</>} show={{ compare: false }} />
      <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden mb-4">
        {[["Opening", d.tb.op], ["Debit", d.tb.dr], ["Credit", d.tb.cr], ["Closing", d.tb.cl]].map(([k, v]) => (
          <div key={k as string} className="bg-surface px-4 py-3 grid gap-0.5"><span className="label">{k}</span><span className="num text-[19px] font-semibold">{fmt(v as number)}</span></div>
        ))}
      </section>
      <div className="grid xl:grid-cols-2 gap-4 mb-4">
        <Panel title="By month" sub="Operating entries">
          <DataTable cols={mcols} rows={months} maxHeight={380} exportName={`${account} by month`} />
        </Panel>
        <Panel title={by ? `By ${nice(by).toLowerCase()}` : "By dimension"} sub="Net movement in the period">
          {f.dims.length > 0 && <Tabs active={by ?? ""} items={f.dims.map((x) => ({ key: x, label: nice(x), href: `?${qs}&by=${x}` }))} />}
          {d.byDim.length ? (
            <>
              <RankBars data={d.byDim.slice(0, 12).map((r) => ({ label: r.dv || "Not set", value: Math.abs(r.v) }))} cur={f.currency} />
              <DataTable cols={[{ key: "label", label: "Value", href: `?${finQs(f, { a: account })}&dim=${by}&dv={dv}` }, { key: "n", label: "Vouchers", type: "int" }, { key: "v", label: "Net", type: "money", tone: "signed" }]}
                rows={d.byDim.map((r) => ({ ...r, label: r.dv || "Not set" }))} maxHeight={300} exportName={`${account} by ${by}`} />
            </>
          ) : <Empty>No movements.</Empty>}
        </Panel>
      </div>
      <Panel title="Vouchers" sub={`${page * 200 + 1}–${page * 200 + d.vouchers.length}, newest first · debit positive`}>
        <DataTable cols={vcols} rows={vrows} maxHeight={560} exportName={`${account} vouchers`} />
        <div className="flex gap-2 mt-2">
          {page > 0 && <Link className="btn" href={`?${qs}&page=${page - 1}`}>Newer</Link>}
          {d.more && <Link className="btn" href={`?${qs}&page=${page + 1}`}>Older</Link>}
        </div>
      </Panel>
    </>
  );
}
