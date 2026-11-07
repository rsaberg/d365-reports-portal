/**
 * Minimal D365 F&O OData client: Entra ID client-credentials token, server-driven paging, cross-company reads.
 * Env: D365_URL (https://xxx.operations.dynamics.com), D365_TENANT_ID, D365_CLIENT_ID, D365_CLIENT_SECRET.
 * The Entra app must be registered in D365 (System administration > Setup > Microsoft Entra applications)
 * and mapped to a user with read access to the entities in lib/d365/entities.ts.
 */
let cached: { token: string; expires: number } | null = null;

export function odataConfigured() {
  return Boolean(process.env.D365_URL && process.env.D365_TENANT_ID && process.env.D365_CLIENT_ID && process.env.D365_CLIENT_SECRET);
}

async function token(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const base = process.env.D365_URL!.replace(/\/$/, "");
  const res = await fetch(`https://login.microsoftonline.com/${process.env.D365_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.D365_CLIENT_ID!,
      client_secret: process.env.D365_CLIENT_SECRET!,
      scope: `${base}/.default`,
    }),
  });
  if (!res.ok) throw new Error(`Entra token request failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Read every page of an entity for one company. */
export async function readAll(entitySet: string, opts: { company: string; select: string[]; filter?: string }) {
  const base = process.env.D365_URL!.replace(/\/$/, "");
  const params = new URLSearchParams({ "cross-company": "true", $select: opts.select.join(",") });
  const filters = [`dataAreaId eq '${opts.company}'`];
  if (opts.filter) filters.push(opts.filter);
  params.set("$filter", filters.join(" and "));
  let url: string | null = `${base}/data/${entitySet}?${params.toString()}`;
  const out: Record<string, unknown>[] = [];
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json", Prefer: "odata.maxpagesize=5000" },
    });
    if (!res.ok) throw new Error(`${entitySet} (${opts.company}) failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const j = (await res.json()) as { value: Record<string, unknown>[]; "@odata.nextLink"?: string };
    out.push(...j.value);
    url = j["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Companies (legal entities) available in the environment. */
export async function readCompanies() {
  const base = process.env.D365_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/data/LegalEntities?$select=LegalEntityId,Name,AccountingCurrency`, {
    headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`LegalEntities failed ${res.status}`);
  const j = (await res.json()) as { value: { LegalEntityId: string; Name: string; AccountingCurrency?: string }[] };
  return j.value.map((v) => ({ company: v.LegalEntityId.toLowerCase(), name: v.Name, currency: v.AccountingCurrency ?? null }));
}
