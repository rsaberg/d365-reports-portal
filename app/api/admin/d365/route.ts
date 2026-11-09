/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import {
  AUTHORITIES, d365Config, d365Token, decrypt, dropToken, encrypt, ensureCallsTable, getSetting, logCall, mask, putSetting, type D365Config,
} from "@/lib/d365/config";
import { D365_FUNCTIONS, DEFAULT_MAP, baseVars, detectConnection, entityRequest, fetchEntities, parsePostman, runRequest, type PmCollection } from "@/lib/d365/integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Administration → D365 integration (same model as ONE365 / Elsewedy WMS).
   GET  connection (secret masked), Postman collection, function mapping, recent calls
   POST {action:'save', …}            connection settings
   POST {action:'test'}               token + LegalEntities
   POST {action:'upload', collection, environment?, overwrite?}
   POST {action:'map', map:{fn:requestId|'e:Entity[?query]'}}
   POST {action:'request', requestId} POST {action:'testFn', fn, requestId?}
   POST {action:'entities'}           POST {action:'run', requestId | fn, vars?}
   POST {action:'removeCollection'}   POST {action:'disconnect'} */

const json = (b: unknown, status = 200) => NextResponse.json(b, { status });
const EMPTY: PmCollection = { name: "", uploadedAt: "", uploadedBy: "", variables: {}, requests: [] };

/* Data entity without its own query: the default company filter fails on entities that are not company-specific
   (no dataAreaId, e.g. LegalEntities) — retry once without the filter. */
async function runSmart(c: D365Config, coll: PmCollection, rq: any, vars: any, id: string) {
  const r = await runRequest(c, coll, rq, vars);
  if (id.startsWith("e:") && !id.includes("?") && r.status === 400 && /\$filter=dataAreaId/.test(rq.url)) {
    return runRequest(c, coll, { ...rq, url: rq.url.replace(/&?\$filter=dataAreaId eq '\{\{company\}\}'/, "").replace("?&", "?") }, vars);
  }
  return r;
}

async function mapping() {
  return { ...DEFAULT_MAP, ...((await getSetting<Record<string, string>>("d365_map")) || {}) };
}

async function view() {
  await ensureCallsTable();
  const c = await d365Config();
  const coll = await getSetting<PmCollection>("d365_postman");
  const ents = (await getSetting<{ list: string[]; at: string }>("d365_entities")) || { list: [], at: null };
  const calls = await sql<{ at: Date; user_email: string; detail: any }[]>`select at, user_email, detail from portal.d365_calls where action = 'd365.call' order by at desc limit 25`;
  return {
    connection: c
      ? { envUrl: c.envUrl, tenantId: c.tenantId, clientId: c.clientId, company: c.company, authority: c.authority || AUTHORITIES[0], timeoutSec: c.timeoutSec || 30,
          secret: mask(c.secret || (await decrypt(c.secretEnc))), fromEnv: !!c.fromEnv, lastTest: c.lastTest || null, updatedAt: c.updatedAt || null }
      : null,
    collection: coll
      ? { name: coll.name, envName: coll.envName, uploadedAt: coll.uploadedAt, uploadedBy: coll.uploadedBy, variables: Object.keys(coll.variables || {}),
          requests: coll.requests.map(({ body, headers, ...r }) => ({ ...r, hasBody: !!body, headers: headers.map((h) => h.k) })) }
      : null,
    map: await mapping(), functions: D365_FUNCTIONS, vars: Object.keys(baseVars(c, coll)), entities: ents.list || [], entitiesAt: ents.at || null,
    calls: calls.map((x) => ({ at: x.at, user: x.user_email, ...(x.detail || {}) })),
  };
}

async function admin() {
  const u = await currentUser();
  return u && u.role === "admin" ? u : null;
}

export async function GET() {
  if (!(await admin())) return json({ error: "forbidden" }, 403);
  return json(await view());
}

export async function POST(req: Request) {
  const u = await admin();
  if (!u) return json({ error: "forbidden" }, 403);
  const b = await req.json().catch(() => ({}));
  const clean = (v: any) => String(v ?? "").trim();
  try {
    if (b.action === "run") {
      const c = await d365Config(); const coll = await getSetting<PmCollection>("d365_postman");
      if (!c) return json({ error: "D365 connection is not set up" }, 412);
      const map = await mapping();
      const id = String(b.requestId || map[b.fn] || "");
      const fdef = D365_FUNCTIONS.find((f) => f.id === b.fn);
      const rq = id.startsWith("e:") ? entityRequest(id, String(b.method || fdef?.method || "GET").toUpperCase()) : coll?.requests.find((r) => r.id === id);
      if (!rq) return json({ error: b.fn ? `No Postman request is mapped to “${b.fn}”` : "Request not found" }, 404);
      const vars: any = typeof b.vars === "object" && b.vars ? { ...b.vars } : {};
      if (id.startsWith("e:") && vars.__body == null) { const { __body: _ignored, ...rest } = vars; vars.__body = JSON.stringify(b.body && typeof b.body === "object" ? b.body : rest); }
      try {
        const r = await runSmart(c, coll || EMPTY, rq, vars, id);
        await logCall(u.email, "d365.call", { company: c.company, fn: b.fn || "", req: rq.name, method: r.method, url: r.url.slice(0, 300), status: r.status, ms: r.ms, ok: r.ok, ref: clean(b.ref).slice(0, 80) });
        return json({ ok: true, result: r });
      } catch (e: any) {
        await logCall(u.email, "d365.call", { fn: b.fn || "", req: rq.name, method: rq.method, status: 0, ok: false, error: e.message, ref: clean(b.ref).slice(0, 80) });
        return json({ error: e.message }, 502);
      }
    }

    if (b.action === "save") {
      const cur: any = (await getSetting<D365Config>("d365")) || {};
      const envUrl = clean(b.envUrl).replace(/\/+$/, "");
      let url: URL; try { url = new URL(envUrl); } catch { return json({ error: "Environment URL is not valid (e.g. https://contoso.operations.dynamics.com)" }, 400); }
      if (url.protocol !== "https:" || url.pathname.replace(/\/$/, "") !== "") return json({ error: "Use the environment root over https, without a path" }, 400);
      if (!/^[0-9a-f-]{36}$|^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean(b.tenantId))) return json({ error: "Tenant ID should be a GUID or a domain (contoso.onmicrosoft.com)" }, 400);
      if (!/^[0-9a-f-]{36}$/i.test(clean(b.clientId))) return json({ error: "Client (application) ID should be a GUID" }, 400);
      const authority = AUTHORITIES.includes(clean(b.authority)) ? clean(b.authority) : AUTHORITIES[0];
      const next: any = { envUrl: url.origin, tenantId: clean(b.tenantId), clientId: clean(b.clientId), company: clean(b.company).toUpperCase().slice(0, 8), authority,
        timeoutSec: Math.max(5, Math.min(55, +b.timeoutSec || 30)), secretEnc: cur.secretEnc, updatedAt: new Date().toISOString(), updatedBy: u.email };
      if (clean(b.secret)) next.secretEnc = await encrypt(clean(b.secret));
      if (!next.secretEnc) return json({ error: "Client secret is required" }, 400);
      await putSetting("d365", next); dropToken();
      await logCall(u.email, "d365.save", { envHost: url.host, company: next.company, secret: clean(b.secret) ? "changed" : "kept" });
      return json({ ok: true, ...(await view()) });
    }

    if (b.action === "test") {
      const c: any = await d365Config(); if (!c) return json({ error: "Save the connection first" }, 412);
      const out: any = { at: new Date().toISOString() }; dropToken();
      try { await d365Token(c); out.token = { ok: true, msg: "Entra ID token issued" }; } catch (e: any) { out.token = { ok: false, msg: e.message }; }
      if (out.token.ok) {
        try {
          const t0 = Date.now();
          const r = await fetch(c.envUrl + "/data/LegalEntities?$select=LegalEntityId,Name&$top=50", { headers: { Authorization: "Bearer " + (await d365Token(c)), Accept: "application/json" } });
          const j: any = await r.json().catch(() => ({}));
          out.odata = r.ok
            ? { ok: true, msg: `${(j.value || []).length} legal entities · ${Date.now() - t0} ms`, entities: (j.value || []).map((x: any) => x.LegalEntityId) }
            : { ok: false, msg: `HTTP ${r.status} ${j?.error?.message || ""}`.trim() };
          if (out.odata.ok && c.company && !out.odata.entities.map((x: string) => x.toUpperCase()).includes(c.company.toUpperCase())) out.odata.warn = `Company ${c.company} not found`;
        } catch (e: any) { out.odata = { ok: false, msg: e.message }; }
      }
      if (!c.fromEnv) await putSetting("d365", { ...c, lastTest: out });
      await logCall(u.email, "d365.test", { token: out.token.ok, odata: out.odata?.ok });
      return json({ ok: true, test: out, ...(await view()) });
    }

    if (b.action === "upload") {
      const raw = JSON.stringify(b.collection || {}).length + JSON.stringify(b.environment || {}).length;
      if (raw > 3_000_000) return json({ error: "File is too large (max 3 MB)" }, 413);
      const p = parsePostman(b.collection, b.environment);
      /* connection details found in the file fill the connection (existing values are kept unless empty) */
      const det = detectConnection(b.collection, b.environment);
      const cur: any = (await getSetting<D365Config>("d365")) || {};
      const conn: any = { ...cur };
      const filled: string[] = [];
      for (const k of ["envUrl", "tenantId", "clientId", "company"] as const) if (det[k] && (!cur[k] || b.overwrite)) { conn[k] = det[k]; filled.push(k); }
      if (det.secret && (!cur.secretEnc || b.overwrite)) { conn.secretEnc = await encrypt(det.secret); filled.push("secret"); }
      if (filled.length) {
        conn.authority = conn.authority || AUTHORITIES[0]; conn.timeoutSec = conn.timeoutSec || 30; conn.updatedAt = new Date().toISOString(); conn.updatedBy = u.email;
        if (conn.envUrl) { try { conn.envUrl = new URL(conn.envUrl).origin; } catch { /* keep */ } }
        await putSetting("d365", conn); dropToken();
      }
      const detected = { found: Object.keys(det.source), filled, source: det.source, missing: ["envUrl", "tenantId", "clientId", "secret", "company"].filter((k) => !conn[k === "secret" ? "secretEnc" : k]) };
      const coll: PmCollection = { ...p, uploadedAt: new Date().toISOString(), uploadedBy: u.email };
      await putSetting("d365_postman", coll);
      // keep mappings whose request name still exists, then auto-map by name/URL
      const old = (await getSetting<Record<string, string>>("d365_map")) || {};
      const prev = await getSetting<PmCollection>("d365_postman_prev");
      const map: Record<string, string> = {};
      for (const [fn, rid] of Object.entries(old)) {
        if (String(rid).startsWith("e:")) { map[fn] = rid; continue; }
        const name = prev?.requests.find((r) => r.id === rid)?.name; const n = name && p.requests.find((r) => r.name === name); if (n) map[fn] = n.id;
      }
      const guess: Record<string, RegExp> = {
        legalEntities: /LegalEntit/i, customers: /CustomersV|customer/i, workers: /Employee|Worker/i, invoiceHeaders: /SalesInvoiceHeader|invoice(?!.*line)/i, invoiceLines: /SalesInvoice.*Line|invoice.*line/i,
        custTrans: /CustTrans|customer.*trans/i, orderHeaders: /SalesOrderHeader|sales.*order(?!.*line)/i, orderLines: /SalesOrderLine|sales.*line/i, onhand: /OnHand/i,
        quotations: /SalesQuotationHeader|quotation(?!.*line)/i, quotationLines: /SalesQuotationLine|quotation.*line/i, returnHeaders: /ReturnOrderHeader|return(?!.*line)/i, returnLines: /ReturnOrderLine|return.*line/i, token: /oauth2|token/i,
      };
      for (const f of D365_FUNCTIONS) if (!map[f.id]) { const r = p.requests.find((x) => guess[f.id]?.test(x.name + " " + x.url) && (f.method === "GET" ? x.method === "GET" : x.method !== "GET")); if (r) map[f.id] = r.id; }
      await putSetting("d365_map", map);
      await putSetting("d365_postman_prev", coll);
      await logCall(u.email, "d365.upload", { name: p.name, requests: p.requests.length, connection: detected.filled });
      return json({ ok: true, detected, ...(await view()) });
    }

    if (b.action === "map") {
      const coll = await getSetting<PmCollection>("d365_postman");
      const map: Record<string, string> = {};
      Object.entries(b.map || {}).forEach(([fn, rid]: any) => {
        if (!D365_FUNCTIONS.some((f) => f.id === fn) || !rid) return;
        if (String(rid).startsWith("e:") && /^e:[A-Za-z0-9_]+(\?.*)?$/s.test(String(rid))) map[fn] = String(rid).slice(0, 600);
        else if (coll?.requests.some((r) => r.id === rid)) map[fn] = String(rid);
      });
      await putSetting("d365_map", map);
      await logCall(u.email, "d365.map", { n: Object.keys(map).length });
      return json({ ok: true, ...(await view()) });
    }

    if (b.action === "request") {
      const coll = await getSetting<PmCollection>("d365_postman");
      const r = coll?.requests.find((x) => x.id === b.requestId);
      return r ? json({ ok: true, request: { ...r, headers: r.headers.map((h) => ({ k: h.k, v: /authorization|secret|key|token/i.test(h.k) ? "••••" : h.v })) } }) : json({ error: "not found" }, 404);
    }

    if (b.action === "testFn") {
      /* Test one mapping: GET requests run with $top=5 and return the first 5 records; POST requests are not sent (preview only). */
      const c = await d365Config(); if (!c) return json({ error: "D365 connection is not set up" }, 412);
      const coll = await getSetting<PmCollection>("d365_postman");
      const fdef = D365_FUNCTIONS.find((f) => f.id === b.fn);
      const id = String(b.requestId || (await mapping())[b.fn] || "");
      if (!id || id === "e:") return json({ error: "Not mapped" }, 404);
      const rq0 = id.startsWith("e:") ? entityRequest(id, fdef?.method || "GET") : coll?.requests.find((r) => r.id === id);
      if (!rq0) return json({ error: "Request not found" }, 404);
      if (rq0.method !== "GET") return json({ ok: true, preview: true, method: rq0.method, url: rq0.url, body: (rq0.body || "").slice(0, 2000) });
      let url = rq0.url;
      url = /([?&])\$top=\d+/i.test(url) ? url.replace(/([?&])\$top=\d+/i, "$1$top=5") : url + (url.includes("?") ? "&" : "?") + "$top=5";
      if (!/[?&]\$count=/i.test(url)) url += "&$count=true";
      const rq = { ...rq0, url };
      try {
        const r = await runSmart(c, coll || EMPTY, rq, typeof b.vars === "object" && b.vars ? b.vars : {}, id);
        const d = r.data; const rows = Array.isArray(d?.value) ? d.value : Array.isArray(d) ? d : d && typeof d === "object" && !d.error ? [d] : [];
        const cleanRows = rows.slice(0, 5).map((x: any) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith("@odata"))));
        await logCall(u.email, "d365.call", { company: c.company, fn: (b.fn || "") + " (test)", req: rq.name, method: "GET", url: r.url.slice(0, 300), status: r.status, ms: r.ms, ok: r.ok });
        return json({ ok: true, status: r.status, okHttp: r.ok, ms: r.ms, url: r.url, total: d?.["@odata.count"] ?? null, rows: cleanRows, error: r.ok ? null : (d?.error?.message || r.text || "").slice(0, 400), missing: r.missing });
      } catch (e: any) { return json({ error: e.message }, 502); }
    }

    if (b.action === "entities") {
      const c = await d365Config(); if (!c) return json({ error: "Save the connection first" }, 412);
      const list = await fetchEntities(c);
      await putSetting("d365_entities", { list, at: new Date().toISOString() });
      await logCall(u.email, "d365.entities", { n: list.length });
      return json({ ok: true, ...(await view()) });
    }

    if (b.action === "removeCollection") {
      await putSetting("d365_postman", null);
      const m = (await getSetting<Record<string, string>>("d365_map")) || {};
      await putSetting("d365_map", Object.fromEntries(Object.entries(m).filter(([, x]) => String(x).startsWith("e:"))));
      return json({ ok: true, ...(await view()) });
    }

    if (b.action === "disconnect") {
      await putSetting("d365", null); dropToken();
      await logCall(u.email, "d365.disconnect", {});
      return json({ ok: true, ...(await view()) });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 400);
  }
}
