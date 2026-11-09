/**
 * Minimal D365 F&O OData client: Entra ID client-credentials token, server-driven paging, cross-company reads.
 * The connection comes from Administration › D365 integration (or the D365_* environment variables).
 * The Entra app must be registered in D365 (System administration > Setup > Microsoft Entra applications)
 * and mapped to a user with read access to the entities in lib/d365/entities.ts.
 */
import { d365Config, d365Token, requireConfig } from "./config";

export async function odataConfigured() {
  return Boolean(await d365Config());
}

/** Read every page of an entity for one company. */
export async function readAll(entitySet: string, opts: { company: string; select: string[]; filter?: string }) {
  const c = await requireConfig();
  const base = c.envUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ "cross-company": "true", $select: opts.select.join(",") });
  const filters = [`dataAreaId eq '${opts.company}'`];
  if (opts.filter) filters.push(opts.filter);
  params.set("$filter", filters.join(" and "));
  let url: string | null = `${base}/data/${entitySet}?${params.toString()}`;
  const out: Record<string, unknown>[] = [];
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${await d365Token(c)}`, Accept: "application/json", Prefer: "odata.maxpagesize=5000" },
    });
    if (!res.ok) throw new Error(`${entitySet} (${opts.company}) failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const j = (await res.json()) as { value: Record<string, unknown>[]; "@odata.nextLink"?: string };
    out.push(...j.value);
    url = j["@odata.nextLink"] ?? null;
  }
  return out;
}

/** Companies (legal entities) available in the environment. */
export async function readCompanies(entitySet = "LegalEntities") {
  const c = await requireConfig();
  const base = c.envUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/data/${entitySet}?$select=LegalEntityId,Name,AccountingCurrency`, {
    headers: { Authorization: `Bearer ${await d365Token(c)}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${entitySet} failed ${res.status}`);
  const j = (await res.json()) as { value: { LegalEntityId: string; Name: string; AccountingCurrency?: string }[] };
  return j.value.map((v) => ({ company: v.LegalEntityId.toLowerCase(), name: v.Name, currency: v.AccountingCurrency ?? null }));
}
