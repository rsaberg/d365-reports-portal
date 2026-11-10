import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ENTITIES } from "@/lib/d365/entities";
import { dropAllCompanies, dropCompanies, snapshotCompanies, syncCompanyList, syncEntity } from "@/lib/d365/sync";
import { resetGl } from "@/lib/gl/sync";
import { putSetting } from "@/lib/d365/config";
import { sql } from "@/lib/db";
import { loadSnapshot, migrate } from "@/lib/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Data sync driven by the browser, one entity per request, so a large environment never hits one request's time limit.
   POST {action:'start', dropSnapshot?}  → refresh legal entities, optionally remove the demo snapshot; returns the steps
   POST {action:'entity', company, entity, full?, period?:{from,to}} → sync one entity for one company (period: only that date range of transactions)
   POST {action:'snapshot', company, entities?} → (re)load the bundled export of one company without touching anything else
   POST {action:'clearAll', confirm:'DELETE', switchTo?, loadSnapshot?} → remove all synced data and the old connection (environment switch) */
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
    if (b.action === "clearAll") {
      // Switching D365 environment: remove all synced data, the general ledger copy and the statement layout.
      if (b.confirm !== "DELETE") return NextResponse.json({ error: "confirmation missing" }, { status: 400 });
      await dropAllCompanies();
      await resetGl();
      await sql`truncate gl.ledgers, gl.accounts, gl.periods, gl.budget`;
      await sql`refresh materialized view gl.mbal`;
      await putSetting("fs_structure", null);
      // The old environment's connection and mappings go too; the new default company is kept so reports open on it.
      const to = typeof b.switchTo === "string" && /^[a-z0-9]{1,8}$/i.test(b.switchTo) ? b.switchTo.toUpperCase() : "";
      for (const k of ["d365_postman", "d365_postman_prev", "d365_map", "d365_entities"]) await putSetting(k, null);
      await putSetting("d365", to ? { envUrl: "", tenantId: "", clientId: "", company: to } : null);
      // Optional: load the bundled D365 export of that company so the reports work before the live connection is set.
      const loaded = to && b.loadSnapshot ? await loadSnapshot(undefined, [to.toLowerCase()]) : null;
      return NextResponse.json({ ok: true, loaded });
    }
    if (b.action === "snapshot") {
      // Load (or reload) the bundled D365 export of one company, optionally only some entities. Other data is untouched.
      const company = String(b.company || "").toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(company)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
      await migrate();
      const entities = Array.isArray(b.entities) ? b.entities.map(String) : undefined;
      return NextResponse.json({ ok: true, loaded: await loadSnapshot(undefined, [company], entities) });
    }
    if (b.action === "entity") {
      const company = String(b.company || "").toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(company)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
      return NextResponse.json({ ok: true, result: await syncEntity(company, String(b.entity), { full: !!b.full, period: /^\d{4}-\d{2}-\d{2}$/.test(b.period?.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(b.period?.to ?? "") ? { from: b.period.from, to: b.period.to } : undefined }) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
