"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Company = { company: string; name: string };
type Step = { company: string; entity: string; status: "wait" | "run" | "ok" | "error"; rows?: number; error?: string };

/** Runs the sync from the browser, one entity per request, with live progress. */
export default function SyncRunner({ companies, checked, snapshot, configured }: { companies: Company[]; checked: string[]; snapshot: string[]; configured: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState<string[]>(checked);
  const [full, setFull] = useState(false);
  const [drop, setDrop] = useState(snapshot.length > 0);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  async function post(body: unknown) {
    const r = await fetch("/api/admin/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  async function run() {
    if (!pick.length) { setMsg({ err: "Pick at least one company." }); return; }
    setBusy(true); setMsg({}); setSteps([]);
    try {
      const start = await post({ action: "start", dropSnapshot: drop, companies: pick });
      const plan: Step[] = [];
      const globals = new Set<string>();
      for (const company of pick) for (const e of start.entities as { entity: string; global: boolean }[]) {
        if (e.global && globals.has(e.entity)) continue;
        if (e.global) globals.add(e.entity);
        plan.push({ company, entity: e.entity, status: "wait" });
      }
      setSteps(plan);
      let errors = 0;
      for (let i = 0; i < plan.length; i++) {
        setSteps((s) => s.map((x, k) => (k === i ? { ...x, status: "run" } : x)));
        let res: { rows: number; error?: string; entity: string };
        try { res = (await post({ action: "entity", company: plan[i].company, entity: plan[i].entity, full })).result; }
        catch (e) { res = { rows: 0, entity: plan[i].entity, error: e instanceof Error ? e.message : String(e) }; }
        if (res.error) errors++;
        setSteps((s) => s.map((x, k) => (k === i ? { ...x, entity: res.entity, status: res.error ? "error" : "ok", rows: res.rows, error: res.error } : x)));
      }
      setMsg(errors ? { err: `${plan.length - errors} entities synced, ${errors} failed — see the errors below.` } : { ok: `${plan.length} entities synced from D365.` + (start.dropped?.length ? ` Demo data removed: ${start.dropped.map((c: string) => c.toUpperCase()).join(", ")}.` : "") });
      router.refresh();
    } catch (e) {
      setMsg({ err: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const done = steps.filter((s) => s.status === "ok" || s.status === "error").length;
  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-1.5"><legend className="label mb-1">Companies in D365</legend>
        {companies.map((c) => (
          <label key={c.company} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={pick.includes(c.company)} disabled={busy}
              onChange={(e) => setPick(e.target.checked ? [...pick, c.company] : pick.filter((x) => x !== c.company))} />
            {c.company.toUpperCase()} <span className="text-muted">{c.name}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={full} disabled={busy} onChange={(e) => setFull(e.target.checked)} /> Full reload of invoice history (slower)</label>
      {snapshot.length > 0 && (
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={drop} disabled={busy} onChange={(e) => setDrop(e.target.checked)} />
          Remove the demo data ({snapshot.map((c) => c.toUpperCase()).join(", ")}) loaded from the snapshot</label>
      )}
      <div><button className="btn btn-primary" disabled={!configured || busy} onClick={run}>{busy ? `Syncing… ${done}/${steps.length || "…"}` : "Sync from D365"}</button></div>
      {msg.ok && <p className="text-good text-[13px]">{msg.ok}</p>}
      {msg.err && <p className="text-bad text-[13px]">{msg.err}</p>}
      {steps.length > 0 && (
        <div className="overflow-x-auto border border-line rounded-lg max-h-[320px] overflow-y-auto">
          <table className="dtable"><thead><tr><th>Company</th><th>Entity</th><th className="r">Rows</th><th>Status</th></tr></thead>
            <tbody>{steps.map((s, i) => (
              <tr key={i}><td>{s.company.toUpperCase()}</td><td>{s.entity}</td><td className="r num">{s.rows != null ? s.rows.toLocaleString() : ""}</td>
                <td className={s.status === "error" ? "text-bad" : s.status === "ok" ? "text-good" : "text-muted"} style={{ whiteSpace: "normal" }}>
                  {s.status === "wait" ? "Waiting" : s.status === "run" ? "Running…" : s.status === "ok" ? "OK" : s.error?.slice(0, 200)}</td></tr>
            ))}</tbody></table>
        </div>
      )}
      <p className="text-[12px] text-muted">Invoices reload from 1 January last year; customer transactions, open orders, quotations and returns reload in full. Each entity is read from the data entity mapped in D365 integration.</p>
    </div>
  );
}
