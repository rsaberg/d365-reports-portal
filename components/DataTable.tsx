"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export interface Col {
  key: string; label: string;
  type?: "text" | "num" | "money" | "pct" | "date" | "int";
  /** Optional href template, e.g. "/sales/statement?customer={customer}" (fields in braces). */
  href?: string;
  tone?: "badIfPositive" | "signed";
  wrap?: boolean;
}

const fmtVal = (v: any, t: Col["type"]) => {
  if (v === null || v === undefined || v === "") return "–";
  switch (t) {
    case "money": return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "num": return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "int": return Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "pct": return `${(Number(v) * 100).toFixed(1)}%`;
    case "date": return new Date(String(v).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    default: return String(v);
  }
};
const isNum = (t: Col["type"]) => t === "num" || t === "money" || t === "pct" || t === "int";

async function toExcel(name: string, cols: Col[], rows: Record<string, any>[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4),
    style: { numFmt: c.type === "money" ? "#,##0.00" : c.type === "pct" ? "0.0%" : c.type === "int" ? "#,##0" : undefined } }));
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, c.type === "date" && r[c.key] ? new Date(String(r[c.key]).slice(0, 10)) : r[c.key]])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.xlsx`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function DataTable({ cols, rows, total, maxHeight = 560, empty = "No rows for these filters.", exportName }:
  { cols: Col[]; rows: Record<string, any>[]; total?: Record<string, any>; maxHeight?: number; empty?: string; exportName?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((c) => c.key === sort.key);
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = isNum(c?.type) ? Number(x ?? 0) - Number(y ?? 0) : String(x ?? "").localeCompare(String(y ?? ""));
      return r * sort.dir;
    });
  }, [rows, sort, cols]);

  if (!rows.length) return <div className="text-muted text-[13px] py-8 text-center">{empty}</div>;

  const cell = (c: Col, r: Record<string, any>) => {
    const v = r[c.key];
    const text = fmtVal(v, c.type);
    const tone = c.tone === "badIfPositive" && Number(v) > 0 ? "text-bad font-medium" : c.tone === "signed" ? (Number(v) < 0 ? "text-bad" : Number(v) > 0 ? "text-good" : "") : "";
    const content = c.href ? (
      <Link className="text-accent hover:underline" href={c.href.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(r[k] ?? ""))}>{text}</Link>
    ) : text;
    return <td key={c.key} className={`${isNum(c.type) ? "r num" : ""} ${tone} ${c.wrap ? "!whitespace-normal" : ""}`}>{content}</td>;
  };

  return (
    <div className="grid gap-2">
    {exportName && (
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
        <span>{rows.length.toLocaleString()} rows · click a column to sort</span>
        <button type="button" className="btn" onClick={() => toExcel(exportName, cols, sorted)}>Export to Excel</button>
      </div>
    )}
    <div className="overflow-auto border border-line rounded-lg bg-surface" style={{ maxHeight }}>
      <table className="dtable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={isNum(c.type) ? "r" : ""}>
                <button type="button" className="uppercase tracking-[.04em] font-semibold"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : isNum(c.type) ? -1 : 1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{sorted.map((r, i) => <tr key={i}>{cols.map((c) => cell(c, r))}</tr>)}</tbody>
        {total && (
          <tfoot>
            <tr className="font-semibold">
              {cols.map((c, i) => (
                <td key={c.key} className={`${isNum(c.type) ? "r num" : ""} !border-t-2 !border-ink/70 bg-surface sticky bottom-0`}>
                  {i === 0 ? total[c.key] ?? "Total" : total[c.key] !== undefined ? fmtVal(total[c.key], c.type) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </div>
  );
}
