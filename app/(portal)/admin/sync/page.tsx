import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { syncNow } from "@/lib/admin-actions";
import { odataConfigured } from "@/lib/d365/odata";
import { ENTITIES } from "@/lib/d365/entities";
import { PageHead, Panel, Pill, Note } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Sync({ searchParams }: { searchParams: Record<string, string> }) {
  await requireAdmin();
  const configured = odataConfigured();
  const companies = await sql<{ company: string; name: string }[]>`select company, coalesce(name, upper(company)) name from d365.companies order by company`;
  const latest = await sql<{ company: string; entity: string; rows: number; status: string; error: string | null; finished_at: Date | null; source: string }[]>`
    select distinct on (company, entity) company, entity, rows, status, error, finished_at, source from d365.sync_runs order by company, entity, id desc`;
  const counts = await sql<{ company: string; invoices: number; lines: number; trans: number; customers: number }[]>`
    select c.company,
      (select count(*) from d365.invoice_headers h where h.company = c.company)::int invoices,
      (select count(*) from d365.invoice_lines l where l.company = c.company)::int lines,
      (select count(*) from d365.cust_trans t where t.company = c.company)::int trans,
      (select count(*) from d365.customers x where x.company = c.company)::int customers
    from d365.companies c order by 1`;
  const enabled = (process.env.SYNC_COMPANIES ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  return (
    <>
      <PageHead title="Data sync" sub="The portal reads a copy of D365 data, refreshed from OData daily and on demand." />
      {!configured && (
        <Note>
          The live D365 connection isn&apos;t configured on this server, so the data shown is a snapshot loaded with <code>npm run load:snapshot</code>.
          Set <code>D365_URL</code>, <code>D365_TENANT_ID</code>, <code>D365_CLIENT_ID</code>, <code>D365_CLIENT_SECRET</code> and <code>SYNC_COMPANIES</code> to sync live.
        </Note>
      )}
      {searchParams.done && <p className="text-[13px] mb-3"><span className="text-good">{searchParams.done} entities synced.</span>{Number(searchParams.errors) > 0 && <span className="text-bad"> {searchParams.errors} failed; see below.</span>}</p>}
      {searchParams.error && <p className="text-bad text-[13px] mb-3">{searchParams.error}</p>}
      <div className="grid xl:grid-cols-[1fr_1.5fr] gap-4">
        <Panel title="Sync now">
          <form action={syncNow} className="grid gap-3">
            <fieldset className="grid gap-1.5"><legend className="label mb-1">Companies</legend>
              {companies.map((c) => <label key={c.company} className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="companies" value={c.company} defaultChecked={enabled.includes(c.company) || !enabled.length} />{c.company.toUpperCase()} <span className="text-muted">{c.name}</span></label>)}
            </fieldset>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="full" /> Full reload of invoice history (slower)</label>
            <div><button className="btn btn-primary" disabled={!configured}>Sync from D365</button></div>
            <p className="text-[12px] text-muted">Invoices reload from 1 January last year; customer transactions, open orders, quotations and returns reload in full.</p>
          </form>
        </Panel>
        <Panel title="Rows in the portal">
          <div className="overflow-x-auto border border-line rounded-lg">
            <table className="dtable"><thead><tr><th>Company</th><th className="r">Customers</th><th className="r">Invoices</th><th className="r">Invoice lines</th><th className="r">Customer trans.</th></tr></thead>
              <tbody>{counts.map((c) => <tr key={c.company}><td>{c.company.toUpperCase()}</td><td className="r num">{c.customers.toLocaleString()}</td><td className="r num">{c.invoices.toLocaleString()}</td><td className="r num">{c.lines.toLocaleString()}</td><td className="r num">{c.trans.toLocaleString()}</td></tr>)}</tbody></table>
          </div>
        </Panel>
      </div>
      <Panel title="Last run per entity" className="mt-4" sub={`${ENTITIES.length} D365 entities`}>
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="dtable"><thead><tr><th>Company</th><th>Entity</th><th>Source</th><th className="r">Rows</th><th>Status</th><th>Finished</th><th>Error</th></tr></thead>
            <tbody>{latest.map((r) => (
              <tr key={r.company + r.entity}><td>{r.company?.toUpperCase()}</td><td>{r.entity}</td><td>{r.source === "odata" ? "Live OData" : "Snapshot"}</td><td className="r num">{r.rows.toLocaleString()}</td>
                <td>{r.status === "ok" ? <Pill tone="good">OK</Pill> : r.status === "error" ? <Pill tone="bad">Failed</Pill> : <Pill tone="warn">Running</Pill>}</td>
                <td>{r.finished_at?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }) ?? "–"}</td>
                <td className="!whitespace-normal text-bad text-[12px] max-w-[360px]">{r.error ?? ""}</td></tr>))}</tbody></table>
        </div>
      </Panel>
    </>
  );
}
