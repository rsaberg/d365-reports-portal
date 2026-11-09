import { accountNames, addMonths, cashFlow, finScope, monthsBetween, rangeLabel } from "@/lib/gl/fin";
import { FinHead, NoFinance } from "@/components/FinShell";
import StatementTable, { type STRow, type STCol } from "@/components/StatementTable";

export const dynamic = "force-dynamic";
const COMPARES = [{ v: "py", label: "Same period last year" }, { v: "pp", label: "Previous period" }, { v: "none", label: "No comparison" }];

export default async function CashFlowPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope({ ...searchParams, compare: ["pp", "none"].includes(String(searchParams.compare)) ? searchParams.compare : "py" });
  if (!f) return <NoFinance />;
  const names = await accountNames();
  const n = monthsBetween(f.fromM, f.toM);
  const ranges: [string, string][] = [[f.fromM, f.toM]];
  if (f.compare === "py") ranges.push([addMonths(f.fromM, -12), addMonths(f.toM, -12)]);
  if (f.compare === "pp") ranges.push([addMonths(f.fromM, -n), addMonths(f.fromM, -1)]);
  const cf = await Promise.all(ranges.map(([a, b]) => cashFlow(f, a, b, names)));

  // Lay the sections out as statement rows (one value column per period).
  const rows: STRow[] = [];
  const val = (pick: (c: (typeof cf)[number]) => number) => cf.map(pick);
  const section = (id: string, title: string, key: "operating" | "investing" | "financing", total: (c: (typeof cf)[number]) => number, extra?: STRow) => {
    const labels = [...new Set(cf.flatMap((c) => c[key].map(([l]) => l)))];
    const g: STRow = { id, parent: null, depth: 0, kind: "group", label: title, values: [], children: labels.length > 0 || !!extra };
    rows.push(g);
    if (extra) rows.push(extra);
    for (const l of labels) rows.push({ id: `${id}:${l}`, parent: id, depth: 1, kind: "node", label: l, values: cf.map((c) => c[key].find(([x]) => x === l)?.[1] ?? 0), children: false });
    rows.push({ id: `${id}-t`, parent: null, depth: 0, kind: "subtotal", label: `Net cash from ${key} activities`, values: val(total), children: false });
  };
  section("op", "Operating activities", "operating", (c) => c.op, { id: "op:np", parent: "op", depth: 1, kind: "node", label: "Net profit", values: val((c) => c.np), children: false });
  section("inv", "Investing activities", "investing", (c) => c.inv);
  section("fin", "Financing activities", "financing", (c) => c.fin);
  rows.push({ id: "net", parent: null, depth: 0, kind: "subtotal", label: "Net change in cash", values: val((c) => c.net), children: false });
  rows.push({ id: "open", parent: null, depth: 0, kind: "group", label: "Cash and banks at the start", values: val((c) => c.cashOpen), children: false });
  rows.push({ id: "close", parent: null, depth: 0, kind: "subtotal", label: "Cash and banks at the end", values: val((c) => c.cashClose), children: false });
  if (cf.some((c) => Math.abs(c.diff) >= 1)) rows.push({ id: "diff", parent: null, depth: 0, kind: "check", label: "Difference (check the cash-flow classes in Statement layout)", values: val((c) => c.diff), children: false });
  const cols: STCol[] = ranges.map(([a, b], i) => ({ key: `p${i}`, label: rangeLabel(a, b), kind: "value" }));
  // Open the sections by default by giving them as level-1 rows; the table starts collapsed, so users click to open.
  return (
    <>
      <FinHead f={f} title="Cash flow statement" sub="Indirect method — net profit adjusted for the change in every balance-sheet account" compares={COMPARES} />
      <StatementTable cols={cols} rows={rows} drill="" exportName={`Cash flow ${f.company} ${f.fromM}_${f.toM}`} title={`Cash flow · ${f.company.toUpperCase()} · ${f.fromM} to ${f.toM} · ${f.currency}`} />
      <p className="text-[12px] text-muted mt-2">Inflows positive, outflows in brackets. Each balance-sheet heading is classed as operating, investing, financing or cash in Administration › Statement layout.</p>
    </>
  );
}
