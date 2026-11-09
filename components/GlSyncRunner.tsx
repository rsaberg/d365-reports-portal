"use client";
import { useEffect, useState } from "react";

type Status = { steps: { step: string; rows: string; total: string | null; updated_at: string }[]; db: { size: string; gl: string; mb: number; limitMb: number }; companies: { company: string; vouchers: number; first: string | null; last: string | null }[]; orphans: number };
const LABEL: Record<string, string> = { master: "Accounts, periods, ledgers", headers: "Vouchers", lines: "Voucher lines", refresh: "Monthly balances" };

/** General ledger sync from the browser: master data → vouchers → lines → balances, each step resumed until done. */
export default function GlSyncRunner({ configured }: { configured: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [live, setLive] = useState<Record<string, { rows: number; total: number | null; done: boolean }>>({});

  async function post(body: unknown) {
    const r = await fetch("/api/admin/gl-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }
  const load = () => post({ action: "status" }).then(setSt).catch((e) => setMsg({ err: e.message }));
  useEffect(() => { if (configured) load(); }, [configured]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy("run"); setMsg({}); setLive({});
    try {
      for (const step of ["master", "headers", "lines", "refresh"]) {
        for (let guard = 0; guard < 400; guard++) {
          setLive((l) => ({ ...l, [step]: { ...(l[step] ?? { rows: 0, total: null }), done: false } }));
          const r = await post({ action: "step", step });
          setLive((l) => ({ ...l, [step]: { rows: r.rows ?? 0, total: r.total ?? null, done: !!r.done } }));
          if (r.done) break;
        }
      }
      setMsg({ ok: "General ledger is up to date." });
    } catch (e) {
      setMsg({ err: (e instanceof Error ? e.message : String(e)) + " — press Sync again to continue from where it stopped." });
    } finally {
      setBusy("");
      load();
    }
  }
  async function setLimit() {
    const v = window.prompt("Stop loading when the database reaches (MB). Supabase Free allows 500 MB; Pro includes 8 GB.", String(st?.db.limitMb ?? 450));
    if (!v) return;
    try { setSt(await post({ action: "limit", mb: Number(v) })); setMsg({ ok: "Limit saved." }); }
    catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
  }
  async function reset() {
    if (!window.confirm("Delete the general ledger copy in the portal and reload it from D365? Nothing changes in D365.")) return;
    setBusy("reset"); setMsg({});
    try { setSt(await post({ action: "reset" })); setMsg({ ok: "Cleared. Press Sync to load it again." }); }
    catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(""); }
  }

  const stepRow = (step: string) => {
    const saved = st?.steps.find((x) => x.step === step);
    const l = live[step];
    const rows = l?.rows ?? Number(saved?.rows ?? 0);
    const total = l?.total ?? (saved?.total ? Number(saved.total) : null);
    const pct = total ? Math.min(100, (rows / total) * 100) : l?.done ? 100 : 0;
    const state = l ? (l.done ? "Done" : "Running…") : saved ? `Last run ${new Date(saved.updated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" })}` : "Not run yet";
    return (
      <tr key={step}>
        <td>{LABEL[step]}</td>
        <td className="r num">{rows.toLocaleString()}{total && step !== "refresh" ? ` / ${total.toLocaleString()}` : ""}</td>
        <td style={{ minWidth: 140 }}>
          {step !== "master" && step !== "refresh" && <div className="h-1.5 rounded bg-sunken overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>}
        </td>
        <td className={l && !l.done ? "text-warn" : "text-muted"}>{state}</td>
      </tr>
    );
  };

  return (
    <div className="grid gap-3">
      <p className="text-[13px] text-muted">
        Reads every posted voucher (Current layer) of all companies from D365. The first load reads the full history and can take a while;
        later runs read only what was posted since. If a run stops, press Sync again — it continues where it stopped.
      </p>
      <div className="overflow-x-auto border border-line rounded-lg">
        <table className="dtable"><thead><tr><th>Step</th><th className="r">Rows read</th><th>Progress</th><th>Status</th></tr></thead>
          <tbody>{["master", "headers", "lines", "refresh"].map(stepRow)}</tbody></table>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn btn-primary" disabled={!configured || !!busy} onClick={run}>{busy === "run" ? "Syncing…" : "Sync general ledger"}</button>
        <button className="btn" disabled={!configured || !!busy} onClick={reset}>Start over</button>
        {st && <span className="text-[12px] text-muted">Database {st.db.size} of {st.db.limitMb} MB allowed · general ledger {st.db.gl}{st.orphans ? ` · ${st.orphans.toLocaleString()} lines waiting for their voucher` : ""}</span>}
        {st && <button className="btn" disabled={!!busy} onClick={setLimit}>Size limit</button>}
      </div>
      {msg.ok && <p className="text-good text-[13px]">{msg.ok}</p>}
      {msg.err && <p className="text-bad text-[13px]">{msg.err}</p>}
      {st && st.companies.length > 0 && (
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="dtable"><thead><tr><th>Company</th><th className="r">Vouchers</th><th>From</th><th>To</th></tr></thead>
            <tbody>{st.companies.map((c) => <tr key={c.company}><td>{c.company.toUpperCase()}</td><td className="r num">{c.vouchers.toLocaleString()}</td><td>{c.first?.slice(0, 10)}</td><td>{c.last?.slice(0, 10)}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}
