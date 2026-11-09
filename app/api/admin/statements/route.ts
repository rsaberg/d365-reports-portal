import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ensureGl } from "@/lib/gl/schema";
import { accounts, defaultStructure, saveStructure, type FsStructure } from "@/lib/gl/structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Statement layout: POST {action:'save', structure} · {action:'reset'} · {action:'default'} (returns the generated default without saving). */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await ensureGl();
  const b = await req.json().catch(() => ({}));
  if (b.action === "default") return NextResponse.json({ ok: true, structure: defaultStructure(await accounts()) });
  if (b.action === "reset") { await saveStructure(null); return NextResponse.json({ ok: true, structure: defaultStructure(await accounts()) }); }
  if (b.action === "save") {
    const s = b.structure as FsStructure;
    const err = validate(s);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    await saveStructure(s);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

function validate(s: FsStructure): string | null {
  if (!s || !Array.isArray(s.lines) || !s.lines.length) return "The layout has no lines";
  const ids = new Set<string>();
  for (const l of s.lines) {
    if (!l.id || ids.has(l.id)) return `Duplicate or empty line id: ${l.id}`;
    ids.add(l.id);
    if (!["IS", "BS"].includes(l.stmt) || !["group", "subtotal", "earnings"].includes(l.kind) || ![1, -1].includes(l.sign)) return `Line "${l.label}" is not valid`;
    if (!String(l.label ?? "").trim()) return "Every line needs a label";
    if (l.kind === "group" && !(l.prefixes ?? []).length) return `Line "${l.label}" needs at least one account prefix`;
    if ((l.prefixes ?? []).some((p) => !/^[0-9A-Za-z#-]+$/.test(p))) return `Line "${l.label}" has an invalid prefix`;
  }
  for (const l of s.lines) for (const r of l.refs ?? []) if (!ids.has(r)) return `Subtotal "${l.label}" refers to a missing line ${r}`;
  if (!Array.isArray(s.isClasses) || !s.isClasses.length) return "Name the account classes that belong to the income statement";
  for (const v of Object.values(s.cf ?? {})) if (!["operating", "investing", "financing", "cash"].includes(v)) return "Unknown cash-flow class";
  return null;
}
