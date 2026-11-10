"use client";
import { useEffect } from "react";
import AR1 from "@/lib/i18n/ar.json";
import AR2 from "@/lib/i18n/ar2.json";
const AR: Record<string, string> = { ...AR1, ...AR2 };

/* Arabic mode: translates the rendered page (text, placeholders, titles) from the English UI using the dictionary
   in lib/i18n/ar.json plus a few patterns for text with numbers. Charts and tables re-render, so a MutationObserver
   keeps translating new text. The page stays hidden until the first pass is done (no English flash). */

const D = AR as Record<string, string>;
const MON: Record<string, string> = { Jan: "يناير", Feb: "فبراير", Mar: "مارس", Apr: "أبريل", May: "مايو", Jun: "يونيو", Jul: "يوليو", Aug: "أغسطس", Sep: "سبتمبر", Oct: "أكتوبر", Nov: "نوفمبر", Dec: "ديسمبر" };
const UNITS: Record<string, string> = { days: "يوم", day: "يوم", orders: "أوامر", POs: "أوامر شراء", "inv.": "فواتير", open: "مفتوحة", users: "مستخدم", customers: "عميل", invoices: "فاتورة", rows: "صف", items: "صنف", lines: "سطر", roles: "دور", d: "يوم" };

function word(t: string): string | null {
  if (D[t]) return D[t];
  const lower = t.charAt(0).toUpperCase() + t.slice(1);
  if (D[lower]) return D[lower];
  return null;
}
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string | null][] = [
  [/^(.+) Dashboard$/, (m) => `لوحة ${word(m[1]) ?? m[1]}`],
  [/^(.+) \(([A-Z]{3})\)$/, (m) => (word(m[1]) ? `${word(m[1])} (${m[2]})` : null)],
  [/^(.+) \(top (\d+)\)$/i, (m) => `${word(m[1]) ?? m[1]} (أعلى ${m[2]})`],
  [/^As of (.+)$/, (m) => `في ${m[1]}`],
  [/^(Opening|Closing) (\d{4}-\d{2}-\d{2})$/, (m) => `${m[1] === "Opening" ? "رصيد أول" : "رصيد آخر"} ${m[2]}`],
  [/^Inventory value (\d{4}-\d{2}-\d{2})$/, (m) => `قيمة المخزون ${m[2] ?? m[1]}`],
  [/^(0–30 days|31–60|61–90|91–180|181–365|Over 1 year) (qty|value)$/, (m) => `${({ "0–30 days": "0–30 يوم", "Over 1 year": "أكثر من سنة" } as Record<string, string>)[m[1]] ?? m[1]} ${m[2] === "qty" ? "كمية" : "قيمة"}`],
  [/^([\d,]+) units$/, (m) => `${m[1]} وحدة`],
  [/^Item (.+) by day with running balance$/, (m) => `الصنف ${m[1]} يومياً مع الرصيد المتحرك`],
  [/^(Closing value by item group|Value by age) · (.+)$/, (m) => `${m[1].startsWith("Closing") ? "قيمة آخر المدة حسب مجموعة الصنف" : "القيمة حسب العمر"} · ${m[2]}`],
  [/^([\d,]+) rows · click a column to sort$/, (m) => `${m[1]} صف · اضغط على عمود للترتيب`],
  [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2,4})$/, (m) => `${MON[m[1]]} ${m[2]}`],
  [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/, (m) => MON[m[1]]],
  [/^(\d\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/, (m) => `${m[1]} ${MON[m[2]]} ${m[3]}`],
  [/^([\d,.]+) (days|day|orders|POs|inv\.|open|users|customers|invoices|rows|items|lines|roles|d)$/, (m) => `${m[1]} ${UNITS[m[2]]}`],
  [/^(Group|District|Segment) (.+)$/, (m) => `${{ Group: "مجموعة", District: "منطقة", Segment: "شريحة" }[m[1]]} ${m[2]}`],
  [/^(\d+) disabled$/, (m) => `${m[1]} معطّل`],
  [/^(\d+) users affected$/, (m) => `${m[1]} مستخدم متأثر`],
  [/^(\d+) roles defined$/, (m) => `${m[1]} دور معرّف`],
  [/^Data from D365 · last refreshed (.+?)( \(snapshot\))?$/, (m) => `البيانات من D365 · آخر تحديث ${m[1]}${m[2] ? " (لقطة)" : ""}`],
  [/^(.+?) · (.+)$/, (m) => { const a = word(m[1]), b = tr(m[2]); return a || b ? `${a ?? m[1]} · ${b ?? m[2]}` : null; }],
  [/^(.+): (.+)$/, (m) => (word(m[1]) ? `${word(m[1])}: ${tr(m[2]) ?? m[2]}` : null)],
];
function tr(t: string): string | null {
  const w = word(t);
  if (w) return w;
  const lead = t.match(/^([·(]\s*)(.+)$/), trail = t.match(/^(.+?)(\s*[·:,(]+)$/);
  if (lead && word(lead[2])) return lead[1] + word(lead[2]);
  if (trail && word(trail[1])) return word(trail[1]) + trail[2];
  for (const [re, f] of PATTERNS) { const m = t.match(re); if (m) { const r = f(m); if (r) return r; } }
  return null;
}
const done = new WeakMap<Node, string>();
function translateNode(n: Text) {
  const v = n.nodeValue ?? "";
  if (done.get(n) === v) return;
  const t = v.trim();
  if (t.length < 1 || !/[A-Za-z]/.test(t)) return;
  const r = tr(t);
  if (r) { const nv = v.replace(t, r); n.nodeValue = nv; done.set(n, nv); } else done.set(n, v);
}
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "INPUT", "SELECT"]);
function walk(root: Node) {
  if (root.nodeType === 3) { if (!SKIP.has(root.parentElement?.tagName ?? "")) translateNode(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  if (SKIP.has(el.tagName) && el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
  for (const a of ["placeholder", "title", "aria-label"]) { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const r = tr(v.trim()); if (r) el.setAttribute(a, r); } }
  if (el.closest("[data-no-tr]")) return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = w.nextNode();
  while (n) {
    if (n.nodeType === 3) { if (!SKIP.has(n.parentElement?.tagName ?? "")) translateNode(n as Text); }
    else { const e = n as Element; for (const a of ["placeholder", "title", "aria-label"]) { const v = e.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const r = tr(v.trim()); if (r) e.setAttribute(a, r); } } }
    n = w.nextNode();
  }
}

export default function Translator({ lang }: { lang: string }) {
  useEffect(() => {
    if (lang !== "ar") return;
    // Start after hydration (including Suspense boundaries) so React does not see changed text.
    const start = () => setTimeout(() => { walk(document.body); document.documentElement.classList.add("tx-ready"); }, 350);
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
    let pending: Node[] = [];
    let raf = 0;
    const obs = new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === "characterData") pending.push(m.target);
        else m.addedNodes.forEach((n) => pending.push(n));
      }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const p = pending; pending = []; p.forEach(walk); });
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [lang]);
  return null;
}
