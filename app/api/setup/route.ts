import { NextRequest, NextResponse } from "next/server";
import { migrate, loadSnapshot, ensureAdmin, needsSetup } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One-time setup for a new deployment: create tables, load the bundled D365 snapshot, create the first admin.
 * GET /api/setup[?token=<SETUP_TOKEN>][&snapshot=1]
 * - With SETUP_TOKEN set, the matching token is required.
 * - Without SETUP_TOKEN, it runs only while the portal has no administrator yet; the first admin is then
 *   created on the sign-in page.
 */
export async function GET(req: NextRequest) {
  const token = process.env.SETUP_TOKEN;
  const allowed = token ? req.nextUrl.searchParams.get("token") === token : await needsSetup();
  if (!allowed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await migrate();
    const loaded = req.nextUrl.searchParams.get("snapshot") === "1" ? await loadSnapshot() : null;
    const created = process.env.SETUP_ADMIN_EMAIL && process.env.SETUP_ADMIN_PASSWORD
      ? await ensureAdmin(process.env.SETUP_ADMIN_EMAIL, process.env.SETUP_ADMIN_NAME ?? "Portal Admin", process.env.SETUP_ADMIN_PASSWORD)
      : false;
    return NextResponse.json({ ok: true, adminCreated: created, loaded });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
