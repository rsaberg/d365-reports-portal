"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Stmt = "IS" | "BS";
type CfClass = "operating" | "investing" | "financing" | "cash";
interface FsLine { id: string; stmt: Stmt; label: string; kind: "group" | "subtotal" | "earnings"; prefixes?: string[]; refs?: string[]; sign: 1 | -1; cf?: CfClass }
interface FsStructure { lines: FsLine[]; cf: Record<string, CfClass>; roles: Record<string, string[]>; isClasses: string[]; updatedAt?: string }
type Acc = { account: string; name: string };

const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const TABS = [
  { k: "IS", label: "Income statement" }, { k: "BS", label: "Balance sheet" }, { k: "cf", label: "Cash flow classes" },
  { k: "roles", label: "Ratio accounts" }, { k: "unmapped", label: "Unmapped accounts" },
] as const;

export default function StructureEditor({ initial, unmapped, headings, roles, accountCount }: { initial: FsStructure; unmapped: (Acc & { stmt: string })[]; headings: Acc[]; roles: Record<string, string>; accountCount: number }) {
  const router = useRouter();
  const [s, setS] = useState<FsStructure>(initial);
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("IS");
  const [dirty, setDirty] = useState(false);
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const headName = useMemo(() => new Map(headings.map((h) => [h.account.replace(/0+$/, "") || h.account, h.name])), [headings]);
  const prefName = (p: string) => headName.get(p) ?? headings.find((h) => h.account.startsWith(p) && /0{3,}$/.test(h.account))?.name ?? "";

  const upd = (fn: (x: FsStructure) => FsStructure) => { setS((x) => fn(structuredClone(x))); setDirty(true); setMsg({}); };
  const setLine = (id: string, patch: Partial<FsLine>) => upd((x) => ({ ...x, lines: x.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const move = (id: string, d: -1 | 1) => upd((x) => {
    const ls = x.lines; const i = ls.findIndex((l) => l.id === id);
    let j = i + d; while (j >= 0 && j < ls.length && ls[j].stmt !== ls[i].stmt) j += d;
    if (j < 0 || j >= ls.length) return x;
    [ls[i], ls[j]] = [ls[j], ls[i]]; return x;
  });
  const remove = (id: string) => upd((x) => ({ ...x, lines: x.lines.filter((l) => l.id !== id).map((l) => ({ ...l, refs: l.refs?.filter((r) => r !== id) })) }));
  const add = (stmt: Stmt, kind: FsLine["kind"]) => upd((x) => {
    let n = 1; while (x.lines.some((l) => l.id === `${stmt}-new${n}`)) n++;
    x.lines.push({ id: `${stmt}-new${n}`, stmt, label: kind === "subtotal" ? "New total" : "New line", kind, sign: stmt === "IS" ? -1 : 1, ...(kind === "group" ? { prefixes: [] } : { refs: [] }) });
    return x;
  });

  async function call(body: unknown) {
    setBusy(true); setMsg({});
    try {
      const r = await fetch("/api/admin/statements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
      return j;
    } catch (e) { setMsg({ err: e instanceof Error ? e.message : String(e) }); return null; }
    finally { setBusy(false); }
  }
  const save = async () => { if (await call({ action: "save", structure: s })) { setDirty(false); setMsg({ ok: "Saved. Statements use the new layout now." }); router.refresh(); } };
  const reset = async () => {
    if (!window.confirm("Throw away the edited layout and go back to the default built from the chart of accounts?")) return;
    const j = await call({ action: "reset" });
    if (j) { setS(j.structure); setVer((v) => v + 1); setDirty(false); setMsg({ ok: "Back to the default layout." }); router.refresh(); }
  };

  const lines = (stmt: Stmt) => {
    const ls = s.lines.filter((l) => l.stmt === stmt);
    return (
      <div className="grid gap-2">
        <p className="text-[12px] text-muted">
          A <b>line</b> adds up the accounts starting with its prefixes (the longest matching prefix wins). A <b>total</b> adds up the lines it lists — leave it empty to add every line above it.
          {stmt === "BS" ? " Sign +1 shows debit balances positive (assets), −1 shows credit balances positive (liabilities, equity)." : " Income-statement lines use −1, so revenue shows positive and costs negative."}
        </p>
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="dtable">
            <thead><tr><th></th><th>Label</th><th>Kind</th><th>Account prefixes / lines in the total</th><th>Sign</th><th></th></tr></thead>
            <tbody>
              {ls.map((l) => (
                <tr key={l.id} className={l.kind === "subtotal" ? "bg-sunken/50" : ""}>
                  <td className="text-muted text-[11px]">{l.id}</td>
                  <td><input className="input w-72" value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} aria-label="Label" /></td>
                  <td>
                    <select className="input" value={l.kind} aria-label="Kind" onChange={(e) => { const k = e.target.value as FsLine["kind"]; setLine(l.id, { kind: k, prefixes: k === "group" ? l.prefixes ?? [] : undefined, refs: k === "subtotal" ? l.refs ?? [] : undefined }); }}>
                      <option value="group">Line</option><option value="subtotal">Total</option>{stmt === "BS" && <option value="earnings">Profit not yet closed</option>}
                    </select>
                  </td>
                  <td className="whitespace-normal min-w-[260px]">
                    {l.kind === "group" && (
                      <>
                        <input className="input w-64 font-mono" defaultValue={(l.prefixes ?? []).join(", ")} aria-label="Account prefixes" onBlur={(e) => setLine(l.id, { prefixes: list(e.target.value) })} />
                        <div className="text-[11px] text-muted mt-0.5">{(l.prefixes ?? []).map((p) => `${p} ${prefName(p)}`.trim()).join(" · ")}</div>
                      </>
                    )}
                    {l.kind === "subtotal" && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {ls.filter((o) => o.id !== l.id && o.kind !== "subtotal").map((o) => (
                          <label key={o.id} className="flex items-center gap-1 text-[12px]">
                            <input type="checkbox" checked={(l.refs ?? []).includes(o.id)} onChange={(e) => setLine(l.id, { refs: e.target.checked ? [...(l.refs ?? []), o.id] : (l.refs ?? []).filter((r) => r !== o.id) })} />{o.label}
                          </label>
                        ))}
                        {!(l.refs ?? []).length && <span className="text-[11px] text-muted">(none ticked = every line above)</span>}
                      </div>
                    )}
                    {l.kind === "earnings" && <span className="text-[12px] text-muted">All income-statement accounts not yet closed to retained earnings</span>}
                  </td>
                  <td><select className="input" value={l.sign} aria-label="Sign" onChange={(e) => setLine(l.id, { sign: Number(e.target.value) as 1 | -1 })}><option value={1}>+1</option><option value={-1}>−1</option></select></td>
                  <td className="whitespace-nowrap">
                    <button className="btn !px-2 !min-h-0 !py-1" onClick={() => move(l.id, -1)} aria-label="Move up">↑</button>{" "}
                    <button className="btn !px-2 !min-h-0 !py-1" onClick={() => move(l.id, 1)} aria-label="Move down">↓</button>{" "}
                    <button className="btn !px-2 !min-h-0 !py-1 text-bad" onClick={() => remove(l.id)} aria-label="Delete">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2"><button className="btn" onClick={() => add(stmt, "group")}>Add line</button><button className="btn" onClick={() => add(stmt, "subtotal")}>Add total</button></div>
      </div>
    );
  };

  const cfRows = Object.entries(s.cf).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={`btn !py-1 !min-h-0 ${tab === t.k ? "btn-primary" : ""}`} onClick={() => setTab(t.k)}>{t.label}{t.k === "unmapped" ? ` (${unmapped.length})` : ""}</button>)}
      </div>
      <div key={ver} className="grid gap-3">
      {tab === "IS" && (
        <>
          <label className="flex items-center gap-2 text-[13px]">Account classes in the income statement
            <input className="input w-40 font-mono" defaultValue={s.isClasses.join(", ")} onBlur={(e) => upd((x) => ({ ...x, isClasses: list(e.target.value) }))} aria-label="Income statement classes" />
            <span className="text-muted text-[12px]">every other account is a balance-sheet account</span>
          </label>
          {lines("IS")}
        </>
      )}
      {tab === "BS" && lines("BS")}
      {tab === "cf" && (
        <div className="grid gap-2 max-w-3xl">
          <p className="text-[12px] text-muted">Each balance-sheet account prefix goes to a cash-flow section; the longest matching prefix wins, anything unlisted is operating. Mark the cash and bank accounts as Cash.</p>
          <div className="overflow-x-auto border border-line rounded-lg">
            <table className="dtable"><thead><tr><th>Prefix</th><th>Heading</th><th>Section</th><th></th></tr></thead>
              <tbody>{cfRows.map(([p, c]) => (
                <tr key={p}><td className="font-mono">{p}</td><td className="whitespace-normal">{prefName(p)}</td>
                  <td><select className="input" value={c} aria-label={`Section for ${p}`} onChange={(e) => upd((x) => ({ ...x, cf: { ...x.cf, [p]: e.target.value as CfClass } }))}>
                    {(["operating", "investing", "financing", "cash"] as const).map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}</select></td>
                  <td><button className="btn !px-2 !min-h-0 !py-1 text-bad" aria-label="Remove" onClick={() => upd((x) => { delete x.cf[p]; return x; })}>✕</button></td></tr>
              ))}</tbody></table>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const el = (e.currentTarget.elements.namedItem("p") as HTMLInputElement); const p = el.value.trim(); if (p) { upd((x) => ({ ...x, cf: { ...x.cf, [p]: "operating" } })); el.value = ""; } }}>
            <input name="p" className="input w-40 font-mono" placeholder="Prefix e.g. 1201" aria-label="New prefix" /><button className="btn">Add prefix</button>
          </form>
        </div>
      )}
      {tab === "roles" && (
        <div className="grid gap-2 max-w-3xl">
          <p className="text-[12px] text-muted">Account prefixes used by the ratios and the overview (e.g. which accounts are cash, receivables or inventory).</p>
          <table className="dtable border border-line rounded-lg"><tbody>
            {Object.entries(roles).map(([k, label]) => (
              <tr key={k}><td className="w-48">{label}</td><td>
                <input className="input w-full font-mono" defaultValue={(s.roles[k] ?? []).join(", ")} aria-label={label} onBlur={(e) => upd((x) => ({ ...x, roles: { ...x.roles, [k]: list(e.target.value) } }))} />
                <div className="text-[11px] text-muted mt-0.5 whitespace-normal">{(s.roles[k] ?? []).map((p) => `${p} ${prefName(p)}`.trim()).join(" · ") || "none"}</div>
              </td></tr>
            ))}
          </tbody></table>
        </div>
      )}
      {tab === "unmapped" && (
        unmapped.length ? (
          <div className="grid gap-2">
            <p className="text-[12px] text-muted">{unmapped.length} of {accountCount} posting accounts match no line (as saved). They still show on the statements under “Accounts not in the layout”. Add their prefix to a line.</p>
            <div className="overflow-auto border border-line rounded-lg max-h-[60vh]"><table className="dtable"><thead><tr><th>Account</th><th>Name</th><th>Statement</th></tr></thead>
              <tbody>{unmapped.map((a) => <tr key={a.account}><td className="font-mono">{a.account}</td><td>{a.name}</td><td>{a.stmt === "IS" ? "Income statement" : "Balance sheet"}</td></tr>)}</tbody></table></div>
          </div>
        ) : <p className="text-[13px] text-good">Every posting account belongs to a line.</p>
      )}
      </div>
      <div className="flex flex-wrap gap-2 items-center sticky bottom-0 bg-bg/90 backdrop-blur py-2 border-t border-line">
        <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save layout"}</button>
        <button className="btn" disabled={busy || !dirty} onClick={() => { setS(initial); setVer((v) => v + 1); setDirty(false); setMsg({}); }}>Discard changes</button>
        <button className="btn" disabled={busy} onClick={reset}>Reset to default</button>
        {dirty && <span className="text-warn text-[12px]">Unsaved changes</span>}
        {msg.ok && <span className="text-good text-[13px]">{msg.ok}</span>}
        {msg.err && <span className="text-bad text-[13px]">{msg.err}</span>}
      </div>
    </div>
  );
}
