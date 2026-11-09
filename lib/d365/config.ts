import { sql } from "../db";

/**
 * D365 connection settings, stored in portal.settings (Administration › D365 integration).
 * The client secret is encrypted with AES-256-GCM; it is never sent back to the browser.
 * Falls back to the D365_* environment variables when nothing is saved in the portal.
 */

export interface D365Config {
  envUrl: string; tenantId: string; clientId: string; company: string; authority?: string; timeoutSec?: number;
  secretEnc?: string;
  /** Plain secret from environment variables only — never stored. */
  secret?: string;
  fromEnv?: boolean;
  lastTest?: unknown; updatedAt?: string; updatedBy?: string;
}

export const AUTHORITIES = ["https://login.microsoftonline.com", "https://login.microsoftonline.us", "https://login.chinacloudapi.cn"];

/* ---------- settings (portal.settings key / jsonb value) ---------- */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [r] = await sql<{ value: T }[]>`select value from portal.settings where key = ${key}`;
  return r ? r.value : null;
}
export async function putSetting(key: string, value: unknown) {
  if (value == null) {
    await sql`delete from portal.settings where key = ${key}`;
    return;
  }
  await sql`insert into portal.settings (key, value) values (${key}, ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

/* ---------- encryption ---------- */
// A key that stays stable when SESSION_SECRET is rotated; set D365_ENC_KEY to pin it explicitly.
async function encKey() {
  const base = "portal-enc:" + (process.env.D365_ENC_KEY || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SESSION_SECRET || "local-dev-only");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encKey(), new TextEncoder().encode(plain)));
  return "v1:" + b64(iv) + ":" + b64(ct);
}
export async function decrypt(enc?: string | null): Promise<string> {
  if (!enc) return "";
  try {
    const [, iv, ct] = enc.split(":");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, await encKey(), Buffer.from(ct, "base64"));
    return new TextDecoder().decode(pt);
  } catch {
    return "";
  }
}
export const mask = (s: string) => (!s ? "" : s.length <= 8 ? "••••" : s.slice(0, 4) + "••••" + s.slice(-4));

/* ---------- connection ---------- */
/** Saved connection, or the D365_* environment variables when nothing is saved. */
export async function d365Config(): Promise<D365Config | null> {
  const saved = await getSetting<D365Config>("d365");
  if (saved?.envUrl) return saved;
  const e = process.env;
  if (e.D365_URL && e.D365_TENANT_ID && e.D365_CLIENT_ID && e.D365_CLIENT_SECRET) {
    return { envUrl: e.D365_URL.replace(/\/$/, ""), tenantId: e.D365_TENANT_ID, clientId: e.D365_CLIENT_ID, secret: e.D365_CLIENT_SECRET,
      company: (e.SYNC_COMPANIES ?? "").split(",")[0]?.trim().toUpperCase() ?? "", fromEnv: true };
  }
  return null;
}
export async function requireConfig(): Promise<D365Config> {
  const c = await d365Config();
  if (!c) throw new Error("The D365 connection is not set up. Open Administration › D365 integration.");
  return c;
}
export const envHost = (c?: D365Config | null) => { try { return c?.envUrl ? new URL(c.envUrl).host.toLowerCase() : ""; } catch { return ""; } };

const g = globalThis as unknown as { __PORTAL_D365TOK__?: Map<string, { tok: string; exp: number }> };
const TOK = g.__PORTAL_D365TOK__ || (g.__PORTAL_D365TOK__ = new Map());
export function dropToken() { TOK.clear(); }

/** Entra ID client-credentials token for the environment (cached until a minute before expiry). */
export async function d365Token(c: D365Config): Promise<string> {
  const key = c.tenantId + "|" + c.clientId + "|" + c.envUrl;
  const t = TOK.get(key);
  if (t && t.exp > Date.now() + 60000) return t.tok;
  const secret = c.secret || (await decrypt(c.secretEnc));
  if (!c.tenantId || !c.clientId || !c.envUrl) throw new Error("D365 connection is incomplete (tenant, client ID and environment URL are required)");
  if (!secret) throw new Error("The saved client secret cannot be read. Enter it again in Administration › D365 integration.");
  const base = (c.authority || AUTHORITIES[0]).replace(/\/$/, "");
  const r = await fetch(`${base}/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: secret, scope: c.envUrl.replace(/\/$/, "") + "/.default" }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error("Token request failed: " + String(j.error_description || j.error || r.status).split("\r\n")[0]);
  TOK.set(key, { tok: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 });
  return j.access_token;
}

/** Creates the calls log on deployments migrated before it existed (same statement as db/schema.sql). */
let callsReady = false;
export async function ensureCallsTable() {
  if (callsReady) return;
  await sql.unsafe(`create table if not exists portal.d365_calls (
    id bigserial primary key, at timestamptz not null default now(), user_email text, action text not null, detail jsonb);
    create index if not exists d365_calls_at_ix on portal.d365_calls (at desc);`);
  callsReady = true;
}

/** Recent D365 calls shown on the integration page. */
export async function logCall(user: string, action: string, detail: Record<string, unknown>) {
  try {
    await sql`insert into portal.d365_calls (user_email, action, detail) values (${user}, ${action}, ${sql.json(detail as never)})`;
  } catch {
    /* logging must never break a call */
  }
}
