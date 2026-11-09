import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { GL_STEPS, glStatus, resetGl, runGlStep, type GlStep } from "@/lib/gl/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* General ledger sync, driven by the browser: each call runs one step for up to ~4 minutes and reports progress.
   POST {action:'status'} · {action:'step', step:'master'|'headers'|'lines'|'refresh'} · {action:'reset'} */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "status") return NextResponse.json({ ok: true, ...(await glStatus()) });
    if (b.action === "step" && GL_STEPS.includes(b.step)) return NextResponse.json({ ok: true, ...(await runGlStep(b.step as GlStep)) });
    if (b.action === "reset") { await resetGl(); return NextResponse.json({ ok: true, ...(await glStatus()) }); }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
