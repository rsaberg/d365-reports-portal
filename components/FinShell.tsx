import Link from "next/link";
import FinFilters, { type FinFilterProps } from "./FinFilters";
import { PageHead, Note } from "./ui";
import { dimValues, finQs, type FinScope } from "@/lib/gl/fin";
import { sql } from "@/lib/db";


/** Page header + finance filters + scope notes shared by the finance pages. */
export async function FinHead({ f, title, sub, show, views, compares, actions }: {
  f: FinScope; title: string; sub?: React.ReactNode; show?: FinFilterProps["show"]; views?: FinFilterProps["views"]; compares?: FinFilterProps["compares"]; actions?: React.ReactNode;
}) {
  const dv = f.dim ? await dimValues(f.dim, f.cos) : [];
  const [load] = await sql<{ rows: string; total: string | null }[]>`select rows, total from gl.sync_state where step = 'lines'`;
  const pct = load?.total ? Math.min(100, (Number(load.rows) / Number(load.total)) * 100) : null;
  const name = f.consolidated ? "All companies (consolidated)" : `${f.company.toUpperCase()} · ${f.companies.find((c) => c.company === f.company)?.name ?? ""}`;
  return (
    <>
      <PageHead title={title} sub={sub ?? <>{name} · {f.currency}</>} actions={actions} />
      <FinFilters company={f.company} companies={f.companies.map((c) => ({ company: c.company, name: c.name }))} currency={f.currency} currencies={f.currencies}
        fromM={f.fromM} toM={f.toM} years={f.years} compare={f.compare} compares={compares} dims={f.dims} dim={f.dim} dimValue={f.dimValue} dimValues={dv}
        view={f.view} views={views} by={f.by} show={show} />
      {pct !== null && pct < 99.5 && <Note>The general ledger is still loading from D365 ({pct.toFixed(0)}% of voucher lines). Figures are incomplete until it finishes.</Note>}
      {f.excluded.length > 0 && <Note>{f.excluded.map((c) => c.toUpperCase()).join(", ")} {f.excluded.length > 1 ? "keep" : "keeps"} no books in {f.currency} and {f.excluded.length > 1 ? "are" : "is"} left out. Pick another currency to include {f.excluded.length > 1 ? "them" : "it"}.</Note>}
      {f.consolidated && <p className="text-[12px] text-muted -mt-2 mb-3">Consolidated = companies added together{f.repCos.length ? ` (${f.repCos.map((c) => c.toUpperCase()).join(", ")} in reporting currency)` : ""}. Balances between group companies are not eliminated.</p>}
      {f.dim && f.dimValue && <p className="text-[12px] text-muted -mt-2 mb-3">Only lines with {f.dim.toLowerCase()} = {f.dimValue}. <Link className="link" href={`?${finQs(f, { dim: null, dv: null })}`}>Clear</Link></p>}
    </>
  );
}

export function NoFinance() {
  return (
    <div className="card p-6 text-[13px] grid gap-2 max-w-xl">
      <h1 className="font-semibold text-[16px]">No general ledger yet</h1>
      <p className="text-muted">Financial statements need the general ledger from D365. An administrator loads it from Administration › Data sync › General ledger.
        Finance pages are open to administrators and managers.</p>
    </div>
  );
}
