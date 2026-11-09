import { findVouchers, finQs, finScope } from "@/lib/gl/fin";
import { FinHead, NoFinance } from "@/components/FinShell";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";

export default async function VoucherSearch({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope(searchParams);
  if (!f) return <NoFinance />;
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";
  const rows = q.length >= 3 ? await findVouchers(f, q) : [];
  return (
    <>
      <FinHead f={f} title="Voucher search" show={{ period: false, compare: false, dim: false }} />
      <form className="flex gap-2 mb-4" action="">
        {Object.entries({ company: f.company, currency: f.currency }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={q} className="input w-80" placeholder="Voucher, document or journal number (3+ characters)" aria-label="Search" />
        <button className="btn btn-primary">Search</button>
      </form>
      {q.length >= 3 && <DataTable cols={[{ key: "acc_date", label: "Date", type: "date" }, { key: "company", label: "Company" }, { key: "voucher", label: "Voucher", href: `/finance/voucher?id={recid}&${finQs(f)}` }, { key: "journal", label: "Journal" }, { key: "doc", label: "Document" }]}
        rows={rows} empty="No vouchers match." exportName="Vouchers" />}
    </>
  );
}
