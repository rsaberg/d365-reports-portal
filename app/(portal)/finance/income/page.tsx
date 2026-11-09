import { finScope, finQs, statement } from "@/lib/gl/fin";
import { FinHead, NoFinance } from "@/components/FinShell";
import StatementTable from "@/components/StatementTable";

export const dynamic = "force-dynamic";
const VIEWS = [{ v: "standard", label: "Compare" }, { v: "trend", label: "Monthly trend" }, { v: "dim", label: "By dimension" }];

export default async function IncomeStatement({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope(searchParams);
  if (!f) return <NoFinance />;
  const d = await statement(f, "IS");
  return (
    <>
      <FinHead f={f} title="Income statement" views={VIEWS} show={{ compare: f.view === "standard" }} />
      {d.note && <p className="text-[12px] text-muted mb-2">{d.note}</p>}
      <StatementTable cols={d.cols} rows={d.rows} drill={finQs(f)} exportName={`Income statement ${f.company} ${f.fromM}_${f.toM}`} title={`Income statement · ${f.company.toUpperCase()} · ${f.fromM} to ${f.toM} · ${f.currency}`} />
      <p className="text-[12px] text-muted mt-2">Operating periods only (opening and year-end closing entries left out). Revenue and profit positive, costs in brackets. Click a line to open its headings and accounts, an account to see its vouchers.</p>
    </>
  );
}
