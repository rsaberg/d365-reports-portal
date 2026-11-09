import Link from "next/link";
import { finQs, finScope, voucherDetail } from "@/lib/gl/fin";
import { NoFinance } from "@/components/FinShell";
import { PageHead, Empty } from "@/components/ui";
import { dateFmt, fmt } from "@/lib/format";

export const dynamic = "force-dynamic";
const nice = (d: string) => d.charAt(0) + d.slice(1).toLowerCase().replace(/_/g, " ");
const PT: Record<string, string> = { O: "Operating", P: "Opening", C: "Closing" };

export default async function Voucher({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope(searchParams);
  if (!f) return <NoFinance />;
  const v = await voucherDetail(f, String(searchParams.id ?? ""));
  if (!v) return <Empty>Voucher not found or not in your companies.</Empty>;
  const { h } = v;
  const dims = [...new Set(v.lines.flatMap((l) => Object.keys(l.dims ?? {})))].sort();
  const t = v.lines.reduce((a, l) => ({ dr: a.dr + Math.max(l.amt, 0), cr: a.cr - Math.min(l.amt, 0), rdr: a.rdr + Math.max(l.rep, 0), rcr: a.rcr - Math.min(l.rep, 0) }), { dr: 0, cr: 0, rdr: 0, rcr: 0 });
  const qs = finQs(f, { company: h.company });
  return (
    <>
      <PageHead title={`Voucher ${h.voucher || h.recid}`} sub={<>{h.company.toUpperCase()} · {dateFmt(h.acc_date)} · {PT[h.ptype] ?? h.ptype} period{h.category ? ` · ${h.category}` : ""}{h.journal ? ` · journal ${h.journal}` : ""}{h.doc ? ` · document ${h.doc}` : ""}</>} />
      <div className="overflow-auto border border-line rounded-lg bg-surface mb-3">
        <table className="dtable">
          <thead><tr><th>Account</th><th>Name</th>{dims.map((d) => <th key={d}>{nice(d)}</th>)}<th className="r">Debit {v.acc_cur}</th><th className="r">Credit {v.acc_cur}</th>{v.rep_cur && v.rep_cur !== v.acc_cur && <><th className="r">Debit {v.rep_cur}</th><th className="r">Credit {v.rep_cur}</th></>}</tr></thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={i}>
                <td><Link className="link" href={`/finance/account?a=${encodeURIComponent(l.account)}&${qs}`}>{l.account}</Link></td>
                <td className="whitespace-normal">{l.name}</td>
                {dims.map((d) => <td key={d}>{l.dims?.[d] ?? ""}</td>)}
                <td className="r num">{l.amt > 0 ? fmt(l.amt, 2) : ""}</td><td className="r num">{l.amt < 0 ? fmt(-l.amt, 2) : ""}</td>
                {v.rep_cur && v.rep_cur !== v.acc_cur && <><td className="r num">{l.rep > 0 ? fmt(l.rep, 2) : ""}</td><td className="r num">{l.rep < 0 ? fmt(-l.rep, 2) : ""}</td></>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-semibold"><td colSpan={2 + dims.length}>Total</td><td className="r num">{fmt(t.dr, 2)}</td><td className="r num">{fmt(t.cr, 2)}</td>{v.rep_cur && v.rep_cur !== v.acc_cur && <><td className="r num">{fmt(t.rdr, 2)}</td><td className="r num">{fmt(t.rcr, 2)}</td></>}</tr></tfoot>
        </table>
      </div>
      {v.others.length > 0 && <p className="text-[13px]">Same voucher number on other dates: {v.others.map((o, i) => <span key={o.recid}>{i ? " · " : ""}<Link className="link" href={`?id=${o.recid}&${qs}`}>{dateFmt(o.acc_date)}</Link></span>)}</p>}
      <p className="text-[12px] text-muted mt-2">Lines with the same account and dimensions are shown added together.</p>
    </>
  );
}
