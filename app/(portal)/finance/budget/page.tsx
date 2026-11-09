import { finScope, finQs, statement } from "@/lib/gl/fin";
import { sql } from "@/lib/db";
import { FinHead, NoFinance } from "@/components/FinShell";
import StatementTable from "@/components/StatementTable";
import BudgetImport from "@/components/BudgetImport";
import { Note } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BudgetVsActual({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope({ ...searchParams, compare: "budget", view: "standard" });
  if (!f) return <NoFinance />;
  const d = await statement(f, "IS");
  const loaded = await sql<{ company: string; y: number; n: number }[]>`select company, extract(year from month)::int as y, count(*)::int as n from gl.budget group by 1, 2 order by 1, 2`;
  const has = loaded.some((r) => f.accCos.includes(r.company) && r.y >= Number(f.fromM.slice(0, 4)) && r.y <= Number(f.toM.slice(0, 4)));
  return (
    <>
      <FinHead f={f} title="Budget vs actual" show={{ compare: false }} />
      {!has && <Note>No budget loaded for this company and period. D365 has no budget register entries, so budgets are entered here{f.user.role === "admin" ? " — use Import budget below" : " by an administrator"}.</Note>}
      {d.note && <p className="text-[12px] text-muted mb-2">{d.note}</p>}
      <StatementTable cols={d.cols} rows={d.rows} drill={finQs(f)} exportName={`Budget vs actual ${f.company} ${f.fromM}_${f.toM}`} title={`Budget vs actual · ${f.company.toUpperCase()} · ${f.fromM} to ${f.toM} · ${f.currency}`} />
      {f.user.role === "admin" && (
        <section className="card p-4 mt-4">
          <h2 className="font-semibold text-[14px] mb-2">Import budget</h2>
          <BudgetImport companies={f.companies.map((c) => c.company)} loaded={loaded} />
        </section>
      )}
    </>
  );
}
