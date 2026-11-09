import { addMonths, finScope, monthsBetween, rangeLabel, ratios } from "@/lib/gl/fin";
import { FinHead, NoFinance } from "@/components/FinShell";
import { money as moneyShort } from "@/lib/format";

export const dynamic = "force-dynamic";
const COMPARES = [{ v: "py", label: "Same period last year" }, { v: "pp", label: "Previous period" }, { v: "none", label: "No comparison" }];

type Fmt = "x" | "pct" | "days" | "money";
const show = (v: number | null, f: Fmt) => v === null || !Number.isFinite(v) ? "–" : f === "x" ? `${v.toFixed(2)}×` : f === "pct" ? `${(v * 100).toFixed(1)}%` : f === "days" ? `${Math.round(v)} days` : moneyShort(v);

export default async function Ratios({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope({ ...searchParams, compare: ["pp", "none"].includes(String(searchParams.compare)) ? searchParams.compare : "py" });
  if (!f) return <NoFinance />;
  const n = monthsBetween(f.fromM, f.toM);
  const cmpRange: [string, string] | null = f.compare === "py" ? [addMonths(f.fromM, -12), addMonths(f.toM, -12)] : f.compare === "pp" ? [addMonths(f.fromM, -n), addMonths(f.fromM, -1)] : null;
  const [cur, prev] = await Promise.all([ratios(f, f.fromM, f.toM), cmpRange ? ratios(f, cmpRange[0], cmpRange[1]) : null]);
  const fig = cur.figures;
  return (
    <>
      <FinHead f={f} title="Financial ratios" compares={COMPARES} />
      <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden mb-4">
        {[["Revenue", fig.revenue], ["Gross profit", fig.gp], ["Net profit", fig.np], ["Total assets", fig.assets], ["Equity", fig.equity], ["Liabilities", fig.liabilities], ["Current assets", fig.ca], ["Current liabilities", fig.cl]].map(([k, v]) => (
          <div key={k as string} className="bg-surface px-4 py-3 grid gap-0.5"><span className="label">{k}</span><span className="num text-[19px] font-semibold">{moneyShort(v as number)}</span></div>
        ))}
      </section>
      <div className="grid md:grid-cols-2 gap-4">
        {cur.groups.map((g, gi) => (
          <section key={g.name} className="card p-4">
            <h2 className="font-semibold text-[14px] mb-2">{g.name}</h2>
            <table className="dtable">
              <thead><tr><th>Ratio</th><th className="r">{rangeLabel(f.fromM, f.toM)}</th>{cmpRange && <th className="r">{rangeLabel(...cmpRange)}</th>}</tr></thead>
              <tbody>
                {g.items.map((it, i) => {
                  const p = prev?.groups[gi].items[i];
                  const better = p && it.v !== null && p.v !== null && it.good ? (it.good === "high" ? it.v > p.v : it.v < p.v) : null;
                  return (
                    <tr key={it.k}>
                      <td className="whitespace-normal"><div>{it.k}</div><div className="text-[11.5px] text-muted">{it.d}</div></td>
                      <td className={`r num font-medium ${better === null ? "" : better ? "text-good" : "text-bad"}`}>{show(it.v, it.f)}</td>
                      {cmpRange && <td className="r num text-muted">{show(p?.v ?? null, it.f)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="text-[12px] text-muted mt-3">Balance-sheet figures at the end of the period; averages use the start and end of the period. Which accounts count as cash, receivables, inventory, payables and so on is set in Administration › Statement layout. Green = better than the comparison.</p>
    </>
  );
}
