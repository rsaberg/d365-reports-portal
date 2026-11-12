import { NextRequest, NextResponse } from "next/server";
import { siScope } from "@/lib/si/scope";
import { computeKpis } from "@/lib/si/metrics";
import { ROUTES } from "@/lib/si/render";
import { CATALOG, REPORTS } from "@/lib/si/catalog";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read-only Sales Intelligence API (spec §11.2). Same scope rules as the pages (session cookie, company access,
 * sales users pinned to their own sales). GET /api/analytics/sales/kpis?company=dat&g=month&asOf=2026-11-10&cmp=ly
 *   /kpis           → every implemented KPI for the scope
 *   /catalog        → KPI and report registry with statuses
 *   /screen/<slug>  → the data behind a screen ("" = command center); charts and tables as JSON
 */
export async function GET(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const [what = "kpis", ...rest] = params.slug ?? [];
  if (what === "catalog") return NextResponse.json({ version: "sales-kpi-v1.0", kpis: CATALOG, reports: REPORTS });
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const slug = what === "screen" ? rest.join("/") : "";
  const route = ROUTES[slug];
  if (what !== "kpis" && (what !== "screen" || !route)) return NextResponse.json({ error: "Unknown endpoint" }, { status: 404 });
  const s = await siScope(sp, { grain: route?.grain });
  if (!s) return NextResponse.json({ error: "No company access" }, { status: 403 });
  const meta = { company: s.co.company, mode: s.co.mode, currency: s.co.currency, data_as_of: s.co.data_as_of, period: s.pc, filters: s.f.dims };
  const kpis = await computeKpis(s);
  await sql`insert into si.audit ${sql({ user_id: s.user.id, action: "api.read", target: `${what}/${slug}`, detail: { company: s.co.company, q: sp } as never })}`;
  if (what === "kpis") return NextResponse.json({ ...meta, kpis: Object.fromEntries(kpis) });
  const screen = await route.build(s, kpis);
  const blocks = screen.blocks.map((b: any) => (b.t === "note" ? { t: "note", text: typeof b.text === "string" ? b.text : null } : b));
  return NextResponse.json({ ...meta, title: screen.title, layer: screen.layer, blocks, kpis: Object.fromEntries(kpis) });
}
