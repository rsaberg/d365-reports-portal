"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Budget import: paste from Excel or upload .xlsx with columns Company · Account · Month (YYYY-MM) · Amount,
 * or a wide sheet Company · Account · Jan … Dec with a year chosen here. Amounts as the income statement shows them:
 * revenue positive, costs negative.
 */
export default function BudgetImport({ companies, loaded }: { companies: string[]; loaded: { company: string; y: number; n: number }[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  function parse(rows: (string | number | null)[][]) {
    const out: { company: string; account: string; month: string; amount: number }[] = [];
    const bad: number[] = [];
    rows.forEach((r, i) => {
      const cells = r.map((c) => (c === null || c === undefined ? "" : String(c).trim()));
      if (!cells.some(Boolean)) return;
      const [co, acc, ...rest] = cells;
      if (i === 0 && /compan/i.test(co)) return; // header
      const num = (s: string) => Number(s.replace(/[,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
      if (rest.length >= 12 && rest.slice(0, 12).every((x) => x === "" || Number.isFinite(num(x)))) {
        rest.slice(0, 12).forEach((x, m) => { if (x !== "") out.push({ company: co.toLowerCase(), account: acc, month: `${year}-${String(m + 1).padStart(2, "0")}`, amount: num(x) }); });
      } else {
        const m = /^(\d{4})-(\d{1,2})/.exec(rest[0] ?? "");
        const a = num(rest[1] ?? "");
        if (!co || !acc || !m || !Number.isFinite(a)) { bad.push(i + 1); return; }
        out.push({ company: co.toLowerCase(), account: acc, month: `${m[1]}-${m[2].padStart(2, "0")}`, amount: a });
      }
    });
    return { out, bad };
  }

  async function file(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files?.[0];
    if (!fl) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await fl.arrayBuffer());
    const ws = wb.worksheets[0];
    const lines: string[] = [];
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return v.toISOString().slice(0, 7);
        if (v && typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
        return v === null || v === undefined ? "" : String(v);
      });
      lines.push(vals.join("\t"));
    });
    setText(lines.join("\n"));
  }

  async function save() {
    setMsg({});
    const { out, bad } = parse(text.split(/\r?\n/).map((l) => l.split(l.includes("\t") ? "\t" : l.includes(";") ? ";" : ",")));
    if (bad.length) { setMsg({ err: `Rows not understood: ${bad.slice(0, 10).join(", ")}${bad.length > 10 ? "…" : ""}` }); return; }
    if (!out.length) { setMsg({ err: "Nothing to import." }); return; }
    const unknown = [...new Set(out.map((r) => r.company))].filter((c) => !companies.includes(c));
    if (unknown.length) { setMsg({ err: `Unknown companies: ${unknown.join(", ")}` }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/finance/budget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: out, replace }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      setMsg({ ok: `Imported ${j.rows.toLocaleString()} budget lines${j.unknownAccounts?.length ? ` · accounts not in the chart: ${j.unknownAccounts.slice(0, 8).join(", ")}` : ""}.` });
      setText("");
      router.refresh();
    } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3 text-[13px]">
      <p className="text-muted">Paste from Excel or upload a sheet. Either <b>Company · Account · Month (YYYY-MM) · Amount</b> per row, or <b>Company · Account · Jan … Dec</b> (12 month columns) for the year below.
        Enter amounts as the income statement shows them: revenue positive, costs negative. Months imported replace what was there for the same company and account{replace ? ", and the whole year is cleared first for each company imported" : ""}.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="grid gap-1"><span className="label">Year (for 12-column sheets)</span><input className="input w-28" value={year} onChange={(e) => setYear(e.target.value)} /></label>
        <label className="grid gap-1"><span className="label">Excel file</span><input type="file" accept=".xlsx" className="text-[12px]" onChange={file} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Clear each company&apos;s budget for the imported years first</label>
      </div>
      <textarea className="input min-h-[140px] font-mono text-[12px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={"007\t4101001\t2026-01\t1250000\n007\t3101001\t2026-01\t-830000"} />
      <div className="flex gap-2 items-center">
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={save}>{busy ? "Importing…" : "Import budget"}</button>
        {msg.ok && <span className="text-good">{msg.ok}</span>}
        {msg.err && <span className="text-bad">{msg.err}</span>}
      </div>
      {loaded.length > 0 && <p className="text-[12px] text-muted">Loaded: {loaded.map((r) => `${r.company.toUpperCase()} ${r.y} (${r.n.toLocaleString()} lines)`).join(" · ")}</p>}
    </div>
  );
}
