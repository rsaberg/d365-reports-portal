import { defaultCompany } from "@/lib/d365/config";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { saveTargets } from "@/lib/admin-actions";
import { PageHead, Panel, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Targets({ searchParams }: { searchParams: Record<string, string> }) {
  await requireAdmin();
  const companies = await sql<{ company: string; name: string }[]>`select company, coalesce(name, upper(company)) name from d365.companies order by company`;
  const defCompany = await defaultCompany();
  const company = companies.find((c) => c.company === searchParams.company)?.company ?? companies.find((c) => c.company === defCompany)?.company ?? companies[0]?.company;
  const years = (await sql<{ y: number }[]>`select distinct extract(year from invoice_date)::int y from d365.invoice_headers where company = ${company} order by 1`).map((r) => r.y);
  const year = Number(searchParams.year) || years[years.length - 1] || new Date().getFullYear();
  // Salespeople = anyone responsible for invoices in this company, plus anyone who already has targets.
  const people = await sql<{ personnel_number: string; name: string }[]>`
    select p, coalesce(w.name, p) as name from (
      select distinct responsible p from d365.invoice_headers where company = ${company} and responsible <> ''
      union select personnel_number from portal.targets where company = ${company}) x
    left join d365.workers w on w.personnel_number = x.p order by name`.then((r) => r.map((x: any) => ({ personnel_number: x.p, name: x.name })));
  const existing = await sql<{ personnel_number: string; m: number; amount: number }[]>`
    select personnel_number, extract(month from month)::int m, amount from portal.targets where company = ${company} and extract(year from month) = ${year}`;
  const val = (p: string, m: number) => existing.find((e) => e.personnel_number === p && e.m === m)?.amount;

  return (
    <>
      <PageHead title="Sales targets" sub="Monthly targets per salesperson, used by the Sales by Salesperson report. Targets live in the portal, not in D365." />
      <div className="card flex flex-wrap gap-3 p-3 mb-4 items-end">
        <div className="grid gap-1"><span className="label">Company</span>
          <div className="flex flex-wrap gap-1">{companies.map((c) => <Link key={c.company} className={`btn ${c.company === company ? "btn-primary" : ""}`} href={`?company=${c.company}&year=${year}`}>{c.company.toUpperCase()}</Link>)}</div></div>
        <div className="grid gap-1"><span className="label">Year</span>
          <div className="flex flex-wrap gap-1">{[...new Set([...years, new Date().getFullYear()])].map((y) => <Link key={y} className={`btn ${y === year ? "btn-primary" : ""}`} href={`?company=${company}&year=${y}`}>{y}</Link>)}</div></div>
      </div>
      {searchParams.saved && <p className="text-good text-[13px] mb-3">Targets saved.</p>}
      <Panel title={`${company?.toUpperCase()} · ${year}`} sub="amounts in the company's sales currency · leave a cell empty for no target">
        {!people.length ? <Empty>No salespeople found on invoices for this company.</Empty> : (
          <form action={saveTargets}>
            <input type="hidden" name="company" value={company} /><input type="hidden" name="year" value={year} />
            <div className="overflow-x-auto border border-line rounded-lg mb-3">
              <table className="dtable">
                <thead><tr><th>Salesperson</th>{MONTHS.map((m) => <th key={m} className="r">{m}</th>)}</tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.personnel_number}>
                      <td><div className="font-medium">{p.name}</div><div className="text-muted text-[11px]">{p.personnel_number}</div></td>
                      {MONTHS.map((m, i) => (
                        <td key={m} className="!px-1"><input aria-label={`${p.name} ${m}`} name={`t|${p.personnel_number}|${String(i + 1).padStart(2, "0")}`}
                          defaultValue={val(p.personnel_number, i + 1) ?? ""} inputMode="decimal" className="input num w-[104px] text-right" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary">Save targets</button>
          </form>
        )}
      </Panel>
    </>
  );
}
