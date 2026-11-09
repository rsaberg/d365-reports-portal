"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface STCol { key: string; label: string; sub?: string; kind: "value" | "variance" | "pct" | "share" }
export interface STRow { id: string; parent: string | null; depth: number; kind: "group" | "node" | "account" | "subtotal" | "earnings" | "check"; label: string; account?: string; values: (number | null)[]; children: boolean }

const money = (n: number) => (Math.abs(n) < 0.5 ? "–" : n < 0 ? `(${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })})` : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const pct = (n: number | null, signed: boolean) => (n === null || !Number.isFinite(n) ? "–" : `${signed && n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`);

/** Financial statement with expandable lines (line → heading → account), level buttons and Excel export. */
export default function StatementTable({ cols, rows, drill, exportName, title, neutral = false }: { cols: STCol[]; rows: STRow[]; drill: string; exportName: string; title: string; neutral?: boolean }) {
  const maxDepth = useMemo(() => Math.max(0, ...rows.map((r) => r.depth)), [rows]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const visible = (r: STRow) => { let p = r.parent; while (p) { if (!open.has(p)) return false; p = byId.get(p)?.parent ?? null; } return true; };
  const level = (n: number) => setOpen(new Set(rows.filter((r) => r.children && r.depth < n - 1).map((r) => r.id)));
  const toggle = (id: string) => setOpen((o) => { const x = new Set(o); x.has(id) ? x.delete(id) : x.add(id); return x; });

  async function toExcel() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(exportName.slice(0, 31));
    ws.addRow([title]).font = { bold: true, size: 13 };
    const head = ws.addRow(["Line", ...cols.map((c) => (c.sub ? `${c.label} (${c.sub})` : c.label))]);
    head.font = { bold: true };
    for (const r of rows) {
      const row = ws.addRow([r.label, ...r.values.map((v) => (v === null ? null : v))]);
      row.getCell(1).alignment = { indent: r.depth * 2 };
      if (r.kind === "subtotal" || r.kind === "group" || r.kind === "earnings") row.font = { bold: r.kind !== "group" || r.depth === 0 };
      if (r.depth > 0) row.outlineLevel = r.depth;
      cols.forEach((c, i) => { row.getCell(i + 2).numFmt = c.kind === "pct" || c.kind === "share" ? "0.0%" : "#,##0;(#,##0)"; });
    }
    ws.getColumn(1).width = 56;
    cols.forEach((_, i) => { ws.getColumn(i + 2).width = 16; });
    ws.views = [{ state: "frozen", ySplit: 2, xSplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a"); a.href = url; a.download = `${exportName}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const cell = (c: STCol, v: number | null) => {
    if (c.kind === "pct") return <span className={v === null || neutral ? "text-muted" : v >= 0 ? "text-good" : "text-bad"}>{pct(v, true)}</span>;
    if (c.kind === "share") return <span className="text-muted">{pct(v, false)}</span>;
    if (v === null) return "–";
    if (c.kind === "variance") return <span className={Math.abs(v) < 0.5 || neutral ? "" : v > 0 ? "text-good" : "text-bad"}>{money(v)}</span>;
    return money(v);
  };

  if (!rows.length) return <div className="text-muted text-[13px] py-8 text-center">No ledger movements for these filters.</div>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="label mr-1">Level</span>
        {Array.from({ length: maxDepth + 1 }, (_, i) => i + 1).map((n) => <button key={n} type="button" className="btn !px-2.5 !py-1 !min-h-0" onClick={() => level(n)}>{n}</button>)}
        <button type="button" className="btn !py-1 !min-h-0 ml-auto" onClick={toExcel}>Excel</button>
      </div>
      <div className="overflow-auto border border-line rounded-lg max-h-[75vh]">
        <table className="dtable">
          <thead>
            <tr>
              <th className="min-w-[280px]">Line</th>
              {cols.map((c) => <th key={c.key} className="r">{c.label}{c.sub && <div className="normal-case tracking-normal font-normal text-[10.5px]">{c.sub}</div>}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter(visible).map((r) => {
              const strong = r.kind === "subtotal" || r.kind === "check";
              const lineCls = r.kind === "subtotal" ? "font-semibold bg-sunken/60" : r.kind === "check" ? "text-bad font-semibold" : r.depth === 0 ? "font-medium" : "";
              return (
                <tr key={r.id} className={lineCls}>
                  <td style={{ paddingLeft: 10 + r.depth * 18 }} className="whitespace-normal">
                    {r.children ? (
                      <button type="button" className="inline-flex items-center gap-1.5 text-left" aria-expanded={open.has(r.id)} onClick={() => toggle(r.id)}>
                        <span className="inline-block w-3 text-muted">{open.has(r.id) ? "▾" : "▸"}</span>{r.label}
                      </button>
                    ) : r.account ? (
                      <Link className="link" href={`/finance/account?a=${encodeURIComponent(r.account)}&${drill}`}>{r.label}</Link>
                    ) : <span className={strong ? "" : "pl-[18px]"}>{r.label}</span>}
                  </td>
                  {cols.map((c, i) => <td key={c.key} className="r num">{r.values.length ? cell(c, r.values[i] ?? null) : ""}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
