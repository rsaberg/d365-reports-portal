import { d365Token, envHost, type D365Config } from "./config";

/* D365 F&O integration (same model as ONE365): requests come from an uploaded Postman collection or straight from
   a data entity; each portal function is mapped to one of them. The sync reads the mapped data entity. */

export interface PmRequest { id: string; name: string; folder: string; method: string; url: string; headers: { k: string; v: string }[]; body: string; bodyMode: string; auth?: string; desc?: string }
export interface PmCollection { name: string; uploadedAt: string; uploadedBy: string; variables: Record<string, string>; envName?: string; requests: PmRequest[] }

/** Portal functions. `entity` is the default data entity the sync reads. */
export const D365_FUNCTIONS: { id: string; ar: string; en: string; method: string; hint: string; entity?: string }[] = [
  { id: "token", ar: "الحصول على Token (اختياري)", en: "Get access token (optional)", method: "POST", hint: "login.microsoftonline.com/{{tenant_id}}/oauth2/v2.0/token — the portal gets the token itself; map only if you use a custom auth flow" },
  { id: "legalEntities", ar: "الشركات (اختبار الاتصال)", en: "Legal entities (connection test)", method: "GET", hint: "/data/LegalEntities", entity: "LegalEntities" },
  { id: "customers", ar: "العملاء", en: "Customers", method: "GET", hint: "/data/CustomersV3", entity: "CustomersV3" },
  { id: "workers", ar: "الموظفين (المندوبين)", en: "Employees (salespeople)", method: "GET", hint: "/data/EmployeesV2", entity: "EmployeesV2" },
  { id: "invoiceHeaders", ar: "فواتير البيع", en: "Sales invoice headers", method: "GET", hint: "/data/SalesInvoiceHeadersV4", entity: "SalesInvoiceHeadersV4" },
  { id: "invoiceLines", ar: "سطور فواتير البيع", en: "Sales invoice lines", method: "GET", hint: "/data/SalesInvoiceV4Lines", entity: "SalesInvoiceV4Lines" },
  { id: "custTrans", ar: "حركات العملاء (المديونية)", en: "Customer transactions (aging)", method: "GET", hint: "/data/CustTransactions", entity: "CustTransactions" },
  { id: "orderHeaders", ar: "أوامر البيع", en: "Sales orders", method: "GET", hint: "/data/SalesOrderHeadersV4", entity: "SalesOrderHeadersV4" },
  { id: "orderLines", ar: "سطور أوامر البيع", en: "Sales order lines", method: "GET", hint: "/data/SalesOrderLinesV3", entity: "SalesOrderLinesV3" },
  { id: "onhand", ar: "رصيد المخزون", en: "On-hand inventory", method: "GET", hint: "/data/InventorySitesOnHandV2", entity: "InventorySitesOnHandV2" },
  { id: "quotations", ar: "عروض الأسعار", en: "Sales quotations", method: "GET", hint: "/data/SalesQuotationHeadersV2", entity: "SalesQuotationHeadersV2" },
  { id: "quotationLines", ar: "سطور عروض الأسعار", en: "Sales quotation lines", method: "GET", hint: "/data/SalesQuotationLines", entity: "SalesQuotationLines" },
  { id: "returnHeaders", ar: "مرتجعات المبيعات", en: "Return orders", method: "GET", hint: "/data/ReturnOrderHeadersV2", entity: "ReturnOrderHeadersV2" },
  { id: "returnLines", ar: "سطور المرتجعات", en: "Return order lines", method: "GET", hint: "/data/ReturnOrderLinesV2", entity: "ReturnOrderLinesV2" },
];
/** Default mapping: every function with a default entity. */
export const DEFAULT_MAP: Record<string, string> = Object.fromEntries(D365_FUNCTIONS.filter((f) => f.entity).map((f) => [f.id, "e:" + f.entity]));

/** Data entity the sync should read instead of `defaultEntity`, from the saved mapping. */
export function mappedEntity(map: Record<string, string> | null, defaultEntity: string): string {
  const f = D365_FUNCTIONS.find((x) => x.entity === defaultEntity);
  const v = f && map?.[f.id];
  if (v && v.startsWith("e:")) {
    const name = v.slice(2).split("?")[0].replace(/[^A-Za-z0-9_]/g, "");
    if (name) return name;
  }
  return defaultEntity;
}

/* ---------- Postman collection (v2.0 / v2.1) ---------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: any) => (v == null ? "" : String(v));
function urlOf(u: any): string {
  if (!u) return "";
  if (typeof u === "string") return u;
  if (u.raw) return u.raw;
  const host = Array.isArray(u.host) ? u.host.join(".") : str(u.host);
  const path = Array.isArray(u.path) ? u.path.join("/") : str(u.path);
  const q = Array.isArray(u.query) ? u.query.filter((x: any) => !x.disabled).map((x: any) => `${x.key}=${x.value ?? ""}`).join("&") : "";
  return `${u.protocol ? u.protocol + "://" : ""}${host}${path ? "/" + path : ""}${q ? "?" + q : ""}`;
}
function bodyOf(b: any): { body: string; mode: string; ctype?: string } {
  if (!b || !b.mode) return { body: "", mode: "" };
  if (b.mode === "raw") return { body: str(b.raw), mode: "raw", ctype: b.options?.raw?.language === "json" ? "application/json" : undefined };
  if (b.mode === "urlencoded") return { body: (b.urlencoded || []).filter((x: any) => !x.disabled).map((x: any) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value ?? "")}`).join("&"), mode: "urlencoded", ctype: "application/x-www-form-urlencoded" };
  if (b.mode === "graphql") return { body: JSON.stringify(b.graphql || {}), mode: "graphql", ctype: "application/json" };
  return { body: "", mode: b.mode };
}
export function parsePostman(coll: any, env?: any): Omit<PmCollection, "uploadedAt" | "uploadedBy"> {
  const c = coll?.collection || coll;
  if (!c || !Array.isArray(c.item)) throw new Error("Not a Postman collection (expected info + item[])");
  const requests: PmRequest[] = [];
  const walk = (items: any[], folder: string) => items.forEach((it: any) => {
    if (Array.isArray(it.item)) return walk(it.item, folder ? folder + " / " + it.name : it.name);
    const rq = typeof it.request === "string" ? { url: it.request, method: "GET" } : it.request || {};
    const b = bodyOf(rq.body);
    const headers = (rq.header || []).filter((h: any) => !h.disabled && h.key).map((h: any) => ({ k: str(h.key), v: str(h.value) }));
    if (b.ctype && !headers.some((h: any) => h.k.toLowerCase() === "content-type")) headers.push({ k: "Content-Type", v: b.ctype });
    requests.push({ id: "r" + (requests.length + 1), name: str(it.name).slice(0, 120) || "Request " + (requests.length + 1), folder: folder || "", method: str(rq.method || "GET").toUpperCase(),
      url: urlOf(rq.url), headers, body: b.body.slice(0, 50000), bodyMode: b.mode, auth: rq.auth?.type || (c.auth?.type ? "inherit:" + c.auth.type : ""), desc: str(typeof rq.description === "string" ? rq.description : rq.description?.content).slice(0, 400) });
  });
  walk(c.item, "");
  if (!requests.length) throw new Error("The collection has no requests");
  // Never store secrets from the file: secret-like variables are dropped, and secrets in request bodies or headers
  // are replaced by a {{variable}} (the portal injects its own token; the secret lives encrypted in the connection).
  requests.forEach((r) => {
    r.body = r.body.replace(/((?:client_secret|password)=)[^&\s]*/gi, "$1{{client_secret}}").replace(/("(?:client_secret|clientSecret|password)"\s*:\s*)"[^"]*"/g, '$1"{{client_secret}}"');
    r.headers = r.headers.filter((h) => !/^authorization$/i.test(h.k)).map((h) => (SECRETISH.test(h.k) ? { k: h.k, v: "{{" + h.k + "}}" } : h));
  });
  const variables: Record<string, string> = {};
  (c.variable || []).forEach((v: any) => { if (v?.key && !v.disabled && !SECRETISH.test(v.key)) variables[v.key] = str(v.value); });
  const e = env?.environment || env;
  (e?.values || []).forEach((v: any) => { if (v?.key && v.enabled !== false && !SECRETISH.test(v.key)) variables[v.key] = str(v.value); });
  return { name: str(c.info?.name || "Postman collection").slice(0, 120), variables, envName: e?.name ? str(e.name) : undefined, requests: requests.slice(0, 500) };
}

/* Variables available to every request. Secrets and tokens from the uploaded file are never used; the portal injects its own. */
const SECRETISH = /(secret|password|token|bearer|api[_-]?key)/i;
export function baseVars(c: D365Config | null, coll: PmCollection | null): Record<string, string> {
  const v: Record<string, string> = {};
  Object.entries(coll?.variables || {}).forEach(([k, x]) => { if (!SECRETISH.test(k)) v[k] = x; });
  if (c) {
    const u = c.envUrl.replace(/\/$/, "");
    Object.assign(v, { resource: u, url: u, base_url: u, baseUrl: u, environment: u, d365_url: u, D365URL: u, tenant_id: c.tenantId, tenantId: c.tenantId, client_id: c.clientId, clientId: c.clientId,
      company: c.company, dataAreaId: c.company, DataAreaId: c.company, legal_entity: c.company, cross_company: "true" });
  }
  return v;
}
export const subst = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
export const unresolved = (s: string) => [...new Set([...s.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]))];

/** Run one request against the configured environment only (other hosts are refused). */
export async function runRequest(c: D365Config, coll: PmCollection, rq: PmRequest, extra: Record<string, string> = {}) {
  const vars = { ...baseVars(c, coll), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) };
  let url = subst(rq.url, vars).trim();
  if (url.startsWith("/")) url = c.envUrl.replace(/\/$/, "") + url;
  const miss = unresolved(url + " " + rq.body + " " + rq.headers.map((h) => h.v).join(" ")).filter((k) => !SECRETISH.test(k));
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("Invalid URL after variables: " + url); }
  if (u.protocol !== "https:") throw new Error("Only https is allowed");
  if (u.host.toLowerCase() !== envHost(c)) throw new Error(`Request host ${u.host} is not the configured D365 environment (${envHost(c)})`);
  const headers: Record<string, string> = { Accept: "application/json" };
  rq.headers.forEach((h) => { if (!/^authorization$/i.test(h.k) && !/^host$/i.test(h.k)) headers[h.k] = subst(h.v, vars); });
  headers.Authorization = "Bearer " + (await d365Token(c));
  const body = ["GET", "HEAD"].includes(rq.method) ? undefined : subst(rq.body || "", vars) || undefined;
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), Math.min(55, c.timeoutSec || 30) * 1000);
  const t0 = Date.now();
  try {
    const r = await fetch(u, { method: rq.method, headers, body, signal: ac.signal, redirect: "manual" });
    const txt = await r.text();
    let data: any = null; try { data = JSON.parse(txt); } catch { /* not json */ }
    return { status: r.status, ok: r.ok, ms: Date.now() - t0, url: u.toString(), method: rq.method, contentType: r.headers.get("content-type") || "", data, text: data ? "" : txt.slice(0, 20000), size: txt.length, missing: miss };
  } finally { clearTimeout(tm); }
}

/* Read the connection (environment URL, tenant, client ID, secret, company) from a Postman collection/environment:
   variables, the OAuth2 auth block, the token request (login.microsoftonline.com/{tenant}/oauth2…) and request URLs. */
export function detectConnection(coll: any, env?: any) {
  const c = coll?.collection || coll || {};
  const vars: Record<string, string> = {};
  const addVars = (arr: any[]) => (arr || []).forEach((v: any) => { if (v?.key && v.enabled !== false && !v.disabled && v.value != null && String(v.value) !== "") vars[v.key] = String(v.value); });
  addVars(c.variable); const e = env?.environment || env; addVars(e?.values);
  const res = (s: string, d = 0): string => (d > 5 ? s : s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => (k in vars ? res(vars[k], d + 1) : m)));
  const pick = (re: RegExp, ok: (v: string) => boolean) => { for (const [k, v] of Object.entries(vars)) { const r = res(v).trim(); if (re.test(k) && ok(r)) return r; } return ""; };
  const isUrl = (v: string) => /^https:\/\/[^/{}\s]+/i.test(v);
  const isGuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const isTenant = (v: string) => isGuid(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v);
  const origin = (v: string) => { try { return new URL(v.replace(/\/\.default$/, "")).origin; } catch { return ""; } };
  const out: any = { envUrl: "", tenantId: "", clientId: "", secret: "", company: "", source: {} as Record<string, string> };
  const set = (k: string, v: string, src: string) => { if (v && !out[k]) { out[k] = v; out.source[k] = src; } };

  set("envUrl", origin(pick(/^(resource|d365_?url|d365url|fo_?url|base_?url|baseurl|url|environment|env_?url|host|aos|instance|server)$/i, (v) => isUrl(v) && /dynamics|operations|cloudax/i.test(v))), "variable");
  set("tenantId", pick(/tenant/i, isTenant), "variable");
  set("clientId", pick(/^(client_?id|clientid|app_?id|application_?id|appid)$/i, isGuid), "variable");
  set("secret", pick(/^(client_?secret|clientsecret|secret|app_?secret)$/i, (v) => v.length >= 8 && !/\{\{/.test(v)), "variable");
  set("company", pick(/^(company|dataareaid|data_?area_?id|legal_?entity|le|entity|companyid)$/i, (v) => /^[A-Za-z0-9]{2,8}$/.test(v)).toUpperCase(), "variable");

  // OAuth2 auth blocks (collection, folders, requests) and token requests
  const kv = (arr: any) => Object.fromEntries((Array.isArray(arr) ? arr : []).map((x: any) => [x.key, x.value == null ? "" : res(String(x.value))]));
  const scanAuth = (a: any, where: string) => {
    if (!a || a.type !== "oauth2") return; const o = kv(a.oauth2);
    const tu = String(o.accessTokenUrl || ""); const tm = tu.match(/login\.microsoftonline\.(?:com|us)\/([^/]+)\/oauth2/i);
    if (tm && isTenant(tm[1])) set("tenantId", tm[1], where + " OAuth2");
    if (isGuid(o.clientId || "")) set("clientId", o.clientId, where + " OAuth2");
    if ((o.clientSecret || "").length >= 8 && !/\{\{/.test(o.clientSecret)) set("secret", o.clientSecret, where + " OAuth2");
    const sc = origin(String(o.scope || o.resource || "")); if (sc && /dynamics|operations/i.test(sc)) set("envUrl", sc, where + " OAuth2");
  };
  scanAuth(c.auth, "collection");
  const urls: string[] = [];
  const walk = (items: any[]) => (items || []).forEach((it: any) => {
    if (Array.isArray(it.item)) { scanAuth(it.auth, "folder"); return walk(it.item); }
    const rq = typeof it.request === "string" ? { url: it.request } : it.request || {};
    scanAuth(rq.auth, "request");
    const u = res(typeof rq.url === "string" ? rq.url : rq.url?.raw || "");
    const tm = u.match(/login\.microsoftonline\.(?:com|us)\/([^/?]+)\/oauth2/i);
    if (tm) {
      if (isTenant(tm[1])) set("tenantId", tm[1], "token request");
      let body: Record<string, string> = {};
      if (rq.body?.mode === "urlencoded") body = kv(rq.body.urlencoded);
      else if (rq.body?.mode === "formdata") body = kv(rq.body.formdata);
      else if (rq.body?.mode === "raw") { try { body = Object.fromEntries(new URLSearchParams(res(rq.body.raw || "")).entries()); } catch { /* ignore */ } }
      if (isGuid(body.client_id || "")) set("clientId", body.client_id, "token request");
      if ((body.client_secret || "").length >= 8 && !/\{\{/.test(body.client_secret)) set("secret", body.client_secret, "token request");
      const sc = origin(body.resource || body.scope || ""); if (sc && /dynamics|operations|cloudax/i.test(sc)) set("envUrl", sc, "token request");
    } else if (u) urls.push(u);
  });
  walk(c.item);
  if (!out.envUrl) { const cnt: Record<string, number> = {}; urls.map(origin).filter((o) => /dynamics|operations|cloudax/i.test(o)).forEach((o) => { cnt[o] = (cnt[o] || 0) + 1; }); const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]; if (best) set("envUrl", best[0], "request URLs"); }
  if (!out.company) { for (const u of urls) { const m = decodeURIComponent(u).match(/dataAreaId\s+eq\s+'([A-Za-z0-9]{2,8})'/i); if (m) { set("company", m[1].toUpperCase(), "request filter"); break; } } }
  return out as { envUrl: string; tenantId: string; clientId: string; secret: string; company: string; source: Record<string, string> };
}

/* ---------- Data entities (OData service document) ---------- */
export async function fetchEntities(c: D365Config): Promise<string[]> {
  const r = await fetch(c.envUrl.replace(/\/$/, "") + "/data/", { headers: { Authorization: "Bearer " + (await d365Token(c)), Accept: "application/json" } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status} ${j?.error?.message || ""}`.trim());
  return [...new Set<string>((j.value || []).filter((x: any) => !x.kind || x.kind === "EntitySet").map((x: any) => String(x.name || x.url)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
/** A mapping value 'e:<Entity>[?<query>]' runs straight against /data/<Entity> instead of a Postman request. */
export function entityRequest(value: string, method: string): PmRequest {
  const [name, q0] = value.slice(2).split(/\?(.*)/s);
  let q = q0;
  if (q && !/[=$&]/.test(q) && /^[A-Za-z0-9]{2,8}$/.test(q.trim())) q = `cross-company=true&$filter=dataAreaId eq '${q.trim()}'${method === "GET" ? "&$top=1000" : ""}`; // a bare company code
  const ent = name.replace(/[^A-Za-z0-9_]/g, "");
  const get = method === "GET";
  const query = q != null && q !== "" ? q : get ? "cross-company=true&$filter=dataAreaId eq '{{company}}'&$top=1000" : "";
  return { id: value, name: ent + " (data entity)", folder: "Data entities", method: get ? "GET" : method, url: `{{resource}}/data/${ent}${query ? "?" + query : ""}`,
    headers: [{ k: "Content-Type", v: "application/json" }, { k: "OData-Version", v: "4.0" }], body: get ? "" : "{{__body}}", bodyMode: get ? "" : "raw" };
}
