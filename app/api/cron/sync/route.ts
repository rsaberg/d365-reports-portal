import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/d365/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scheduled refresh (vercel.json cron). Vercel sends "Authorization: Bearer <CRON_SECRET>". */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await runSync();
    return NextResponse.json({ ok: results.every((r) => !r.error), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
