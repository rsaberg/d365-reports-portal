import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { d365Config } from "@/lib/d365/config";
import { defaultCompanies, snapshotCompanies, syncCompanyList } from "@/lib/d365/sync";
import SyncRunner from "@/components/SyncRunner";
import GlSyncRunner from "@/components/GlSyncRunner";
import InventSyncRunner from "@/components/InventSyncRunner";
import { ENTITIES } from "@/lib/d365/entities";
import { PageHead, Panel, Pill, Note } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Sync() {
  await requireAdmin();
  const conn = await d365Config();
  const configured = Boolean(conn);
  // Companies come from D365 itself (legal entities) through the D365 integration connection.
  let live: { company: string; name: string }[] = [];
  let liveError = "";
  if (configured) {
    try { live = (await syncCompanyList()).map((c) => ({ company: c.company, name: c.name ?? c.company.toUpperCase() })).sort((a, b) => a.company.localeCompare(b.company)); }
    catch (e) { liveError = e instanceof Error ? e.message : String(e); }
  }
  const snapshot = await snapshotCompanies();
  const checked = (await defaultCompanies()).filter((c) => live.some((x) => x.company === c));
  const latest = await sql<{ company: string; entity: string; rows: number; status: string; error: string | null; finished_at: Date | null; source: string }[]>`
    select distinct on (company, entity) company, entity, rows, status, error, finished_at, source from d365.sync_runs order by company, entity, id desc`;
  const counts = await sql<{ company: string; invoices: number; lines: number; trans: number; customers: number }[]>`
    select c.company,
      (select count(*) from d365.invoice_headers h where h.company = c.company)::int invoices,
      (select count(*) from d365.invoice_lines l where l.company = c.company)::int lines,
      (select count(*) from d365.cust_trans t where t.company = c.company)::int trans,
      (select count(*) from d365.customers x where x.company = c.company)::int customers
    from d365.companies c order by 1`;

  return (
    <>
      <PageHead title="Data sync" sub="The portal reads a copy of D365 data, refreshed from OData daily and on demand." />
      {!configured && (
        <Note>
          The live D365 connection isn&apos;t set up yet, so the data shown is the bundled snapshot.
          Set it up in <a className="underline" href="/admin/d365">D365 integration</a> to sync live.
        </Note>
      )}
      {configured && (
        <p className="text-[13px] text-muted mb-3">
          Connection: <span className="num">{conn!.envUrl.replace(/^https:\/\//, "")}</span> · company <b>{(conn!.company || "–").toUpperCase()}</b> ·{" "}
          <a className="underline" href="/admin/d365">change in D365 integration</a>
        </p>
      )}
      {liveError && <p className="text-bad text-[13px] mb-3">Couldn&apos;t read the companies from D365: {liveError}</p>}
      <div className="grid xl:grid-cols-[1fr_1.5fr] gap-4">
        <Panel title="Sync now">
          <SyncRunner companies={live} checked={checked} snapshot={snapshot} configured={configured && !liveError} />
        </Panel>
        <Panel title="Rows in the portal">
          <div className="overflow-x-auto border border-line rounded-lg">
            <table className="dtable"><thead><tr><th>Company</th><th className="r">Customers</th><th className="r">Invoices</th><th className="r">Invoice lines</th><th className="r">Customer trans.</th></tr></thead>
              <tbody>{counts.map((c) => <tr key={c.company}><td>{c.company.toUpperCase()}</td><td className="r num">{c.customers.toLocaleString()}</td><td className="r num">{c.invoices.toLocaleString()}</td><td className="r num">{c.lines.toLocaleString()}</td><td className="r num">{c.trans.toLocaleString()}</td></tr>)}</tbody></table>
          </div>
        </Panel>
      </div>
      <Panel title="Inventory transactions" className="mt-4" sub="InventTransV5 · month by month">
        <InventSyncRunner companies={live} configured={configured && !liveError} />
      </Panel>
      <Panel title="General ledger (financial statements)" className="mt-4" sub="All companies · full history">
        <GlSyncRunner configured={configured && !liveError} />
      </Panel>
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
