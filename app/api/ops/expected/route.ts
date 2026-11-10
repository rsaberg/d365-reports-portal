import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { EXPECTED_TYPES } from "@/lib/reports/ops";

export const dynamic = "force-dynamic";

/** Save expected entry counts for one day: {company, day, note?, lines:[{doc_type, expected}]}. Admins and managers with access to the company. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role === "sales") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const company = String(b.company || "").toLowerCase();
  if (!u.companies.includes(company)) return NextResponse.json({ error: "No access to this company" }, { status: 403 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.day))) return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  const keys = new Set(EXPECTED_TYPES.map((t) => t.key));
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l: any) => keys.has(l?.doc_type) && Number.isInteger(l?.expected) && l.expected >= 0);
  if (!lines.length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  const note = typeof b.note === "string" ? b.note.slice(0, 500) : null;
  for (const l of lines) {
    await sql`insert into portal.expected_entries (company, day, doc_type, expected, note, entered_by)
      values (${company}, ${b.day}, ${l.doc_type}, ${l.expected}, ${note}, ${u.email})
      on conflict (company, day, doc_type) do update set expected = excluded.expected, note = excluded.note, entered_by = excluded.entered_by, updated_at = now()`;
  }
  return NextResponse.json({ ok: true, saved: lines.length });
}
