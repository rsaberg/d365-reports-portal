import { reportScope, one, today } from "@/lib/page";
import { EXPECTED_TYPES, enteredCounts, expectedEntries } from "@/lib/reports/ops";
import { fmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import DataTable from "@/components/DataTable";
import ExpectedForm from "@/components/ExpectedForm";

export const dynamic = "force-dynamic";
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  if (s.user.role === "sales") return <Empty>Entry monitoring is open to administrators and managers.</Empty>;
  if (!one(searchParams.from)) { s.to = today(); s.from = addDays(s.to, -90); }
  const [exp, entered] = await Promise.all([expectedEntries(s.company, s.from, s.to), enteredCounts(s.company, s.from, s.to)]);
  const label = Object.fromEntries(EXPECTED_TYPES.map((t) => [t.key, t.label]));
  const rows = exp.map((e) => {
    const n = entered.get(`${e.day}|${e.doc_type}`) ?? 0;
    const gap = e.expected - n;
    return { ...e, type: label[e.doc_type] ?? e.doc_type, entered: n, gap, pct: e.expected ? n / e.expected : null,
      result: gap > 0 ? "Missing entries" : gap < 0 ? "More than expected" : "Complete" };
  });
  // Days with entries in D365 but nothing expected recorded: shown so the table can be filled in.
  const expKeys = new Set(exp.map((e) => `${e.day}|${e.doc_type}`));
  const unplanned = [...entered].filter(([k]) => !expKeys.has(k)).map(([k, n]) => { const [day, t] = k.split("|"); return { day, type: label[t] ?? t, entered: n }; })
    .sort((a, b) => b.day.localeCompare(a.day));
  const expTot = rows.reduce((a, r) => a + r.expected, 0), entTot = rows.reduce((a, r) => a + r.entered, 0);
  const missing = rows.reduce((a, r) => a + Math.max(0, r.gap), 0);

  return (
    <>
      <PageHead title="Expected vs entered" sub={<>{s.company.toUpperCase()} · record what should have been entered in D365 and see what is missing</>} />
      <Filters s={s} show={{ currency: false, group: false }} />
      <KpiRow>
        <Kpi label="Expected" value={fmt(expTot)} note={`${fmt(rows.length)} day × type lines`} />
        <Kpi label="Entered in D365" value={fmt(entTot)} note="for the same days and types" />
        <Kpi label="Missing" value={fmt(missing)} tone={missing ? "bad" : "good"} />
        <Kpi label="Completion" value={expTot ? `${Math.min(100, (entTot / expTot) * 100).toFixed(0)}%` : "–"} tone={expTot && entTot >= expTot ? "good" : "warn"} />
        <Kpi label="Lines with a gap" value={fmt(rows.filter((r) => r.gap > 0).length)} tone="bad" />
        <Kpi label="Days entered, not planned" value={fmt(new Set(unplanned.map((u) => u.day)).size)} />
      </KpiRow>
      <Panel title="Record expected entries" sub="one line per day and document type · saving the same day and type again replaces it" className="mb-4">
        <ExpectedForm company={s.company} types={EXPECTED_TYPES} defaultDay={today()} />
      </Panel>
      <Panel title="Expected vs entered" className="mb-4">
        <DataTable exportName={`Expected vs entered ${s.company}`} rows={rows} empty="Nothing recorded for this period yet. Use the form above."
          cols={[{ key: "day", label: "Day", type: "date" }, { key: "type", label: "Document type" }, { key: "expected", label: "Expected", type: "int" },
            { key: "entered", label: "Entered", type: "int" }, { key: "gap", label: "Missing", type: "int", tone: "badIfPositive" }, { key: "pct", label: "Done", type: "pct" },
            { key: "result", label: "Result" }, { key: "note", label: "Note", wrap: true }, { key: "entered_by", label: "Recorded by" }]}
          total={{ day: "Total", expected: expTot, entered: entTot, gap: expTot - entTot }} />
      </Panel>
      <Panel title="Entered in D365 – no expectation recorded" sub="actual counts per day, to compare with your own records">
        <DataTable maxHeight={360} exportName={`Entered ${s.company}`} rows={unplanned}
          cols={[{ key: "day", label: "Day", type: "date" }, { key: "type", label: "Document type" }, { key: "entered", label: "Entered", type: "int" }]} />
      </Panel>
    </>
  );
}
