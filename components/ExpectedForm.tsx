"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ExpectedForm({ company, types, defaultDay }: { company: string; types: { key: string; label: string }[]; defaultDay: string }) {
  const router = useRouter();
  const [day, setDay] = useState(defaultDay);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const lines = Object.entries(vals).filter(([, v]) => v !== "" && Number.isFinite(Number(v))).map(([doc_type, v]) => ({ doc_type, expected: Math.max(0, Math.round(Number(v))) }));
    if (!lines.length) { setMsg("Enter at least one number."); return; }
    setBusy(true); setMsg("");
    const r = await fetch("/api/ops/expected", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, day, note, lines }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || "Could not save."); return; }
    setVals({}); setNote(""); setMsg(`Saved ${lines.length} line${lines.length > 1 ? "s" : ""} for ${day}.`);
    router.refresh();
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><label className="label" htmlFor="x-day">Day</label><input id="x-day" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></div>
        {types.map((t) => (
          <div key={t.key} className="grid gap-1 w-[150px]">
            <label className="label" htmlFor={`x-${t.key}`}>{t.label}</label>
            <input id={`x-${t.key}`} type="number" min={0} inputMode="numeric" className="input num w-full" value={vals[t.key] ?? ""} onChange={(e) => setVals({ ...vals, [t.key]: e.target.value })} />
          </div>
        ))}
        <div className="grid gap-1 flex-1 min-w-[180px]"><label className="label" htmlFor="x-note">Note</label><input id="x-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. from the paper log" /></div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {msg && <p className="text-[12px] text-muted" role="status">{msg}</p>}
    </div>
  );
}
