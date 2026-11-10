"use client";
import { useState } from "react";

type Company = { company: string; name: string };
type Run = { month: string; status: "wait" | "run" | "ok" | "error"; trans?: number; error?: string };

function months(from: string, to: string) {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while ((y < ey || (y === ey && m <= em)) && out.length < 240) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

/** Loads inventory transactions (InventTransV5) one month per request: history before the first month in one call,
    then each month, then the lines that are only physically updated. Feeds Inventory movement and Inventory aging. */
export default function InventSyncRunner({ companies, configured }: { companies: Company[]; configured: boolean }) {
  const now = new Date().toISOString().slice(0, 7);
  const [company, setCompany] = useState(companies[0]?.company ?? "");
  const [from, setFrom] = useState(`${new Date().getFullYear() - 1}-01`);
  const [to, setTo] = useState(now);
  const [history, setHistory] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);

  async function go() {
    const list = [...(history ? [`before:${from}-01`] : []), ...months(from, to), "physical"];
    const st: Run[] = list.map((month) => ({ month, status: "wait" }));
    setRuns([...st]); setBusy(true);
    for (let i = 0; i < st.length; i++) {
      st[i].status = "run"; setRuns([...st]);
      try {
        const r = await fetch("/api/admin/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "inventMonth", company, month: st[i].month }) });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        st[i] = { ...st[i], status: "ok", trans: j.result.trans };
      } catch (e: any) { st[i] = { ...st[i], status: "error", error: String(e.message || e).slice(0, 200) }; }
      setRuns([...st]);
    }
    setBusy(false);
  }
  const done = runs.filter((r) => r.status === "ok" || r.status === "error").length;
  const trans = runs.reduce((a, r) => a + (r.trans || 0), 0);
  const label = (m: string) => (m === "physical" ? "Received / deducted, not invoiced" : m.startsWith("before:") ? `History before ${m.slice(7)}` : m);
  return (
    <div className="text-[13px] space-y-3">
      <p className="text-muted">Loads D365 inventory transactions (InventTransV5) month by month for <b>Inventory movement</b> and <b>Inventory aging</b>. A month is replaced each time it is loaded, so you can re-run the last months after the inventory close.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Company
          <select className="input" value={company} onChange={(e) => setCompany(e.target.value)}>{companies.map((c) => <option key={c.company} value={c.company}>{c.company.toUpperCase()} · {c.name}</option>)}</select></label>
        <label className="flex flex-col gap-1">From month<input className="input" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1">To month<input className="input" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include all history before the first month (opening balance)</label>
        <button className="btn btn-primary" disabled={!configured || busy || !company} onClick={go}>{busy ? `Loading… ${done}/${runs.length}` : "Load inventory transactions"}</button>
      </div>
      {runs.length > 0 && (
        <div className="overflow-x-auto border border-line rounded-lg max-h-[320px]">
          <table className="dtable"><thead><tr><th>Step</th><th>Status</th><th className="r">Transactions</th><th>Error</th></tr></thead>
            <tbody>{runs.map((r) => <tr key={r.month}><td>{label(r.month)}</td><td className={r.status === "error" ? "text-bad" : r.status === "ok" ? "text-good" : ""}>{r.status}</td><td className="r num">{r.trans?.toLocaleString() ?? ""}</td><td className="text-bad">{r.error ?? ""}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td></td><td className="r num">{trans.toLocaleString()}</td><td></td></tr></tfoot></table>
        </div>
      )}
    </div>
  );
}
