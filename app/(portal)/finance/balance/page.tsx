import { finScope, finQs, statement } from "@/lib/gl/fin";
import { FinHead, NoFinance } from "@/components/FinShell";
import StatementTable from "@/components/StatementTable";

export const dynamic = "force-dynamic";
const VIEWS = [{ v: "standard", label: "Compare" }, { v: "trend", label: "Month-end trend" }, { v: "dim", label: "By dimension" }];
const COMPARES = [{ v: "ye", label: "Last financial year end" }, { v: "py", label: "Same date last year" }, { v: "pp", label: "Month before the From month" }, { v: "none", label: "No comparison" }];

export default async function BalanceSheet({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = { ...searchParams, compare: searchParams.compare && searchParams.compare !== "budget" ? searchParams.compare : "ye" };
  const f = await finScope(sp);
  if (!f) return <NoFinance />;
  const d = await statement(f, "BS");
  return (
    <>
      <FinHead f={f} title="Balance sheet" views={VIEWS} compares={COMPARES} show={{ from: f.view === "trend" || f.compare === "pp", compare: f.view === "standard" }} />
      {d.note && <p className="text-[12px] text-muted mb-2">{d.note}</p>}
      <StatementTable cols={d.cols} rows={d.rows} drill={finQs(f, { from: `${f.toM.slice(0, 4)}-01` })} exportName={`Balance sheet ${f.company} ${f.toM}`} title={`Balance sheet · ${f.company.toUpperCase()} · as of end of ${f.toM} · ${f.currency}`} neutral />
      <p className="text-[12px] text-muted mt-2">Balances at the end of the month, before the year-end closing entries. Profit not yet closed to retained earnings shows on its own line under equity.</p>
    </>
  );
}
