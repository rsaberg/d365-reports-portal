import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ENTITIES } from "@/lib/d365/entities";
import { dropCompanies, snapshotCompanies, syncCompanyList, syncEntity } from "@/lib/d365/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Data sync driven by the browser, one entity per request, so a large environment never hits one request's time limit.
   POST {action:'start', dropSnapshot?}  → refresh legal entities, optionally remove the demo snapshot; returns the steps
   POST {action:'entity', company, entity, full?} → sync one entity for one company */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "start") {
      const companies = await syncCompanyList();
      let dropped: string[] = [];
      if (b.dropSnapshot) {
        const live = new Set(companies.map((c) => c.company));
        dropped = (await snapshotCompanies()).filter((c) => !live.has(c) || !(b.companies || []).includes(c));
        await dropCompanies(dropped);
        await syncCompanyList(); // keep the D365 list after the cleanup
      }
      return NextResponse.json({ ok: true, dropped, entities: ENTITIES.map((d) => ({ entity: d.entitySet, global: !!d.global })) });
    }
    if (b.action === "entity") {
      const company = String(b.company || "").toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(company)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
      return NextResponse.json({ ok: true, result: await syncEntity(company, String(b.entity), { full: !!b.full }) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
