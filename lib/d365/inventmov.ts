import { sql } from "../db";
import { readAll } from "./odata";
import { getSetting } from "./config";
import { mappedEntity } from "./integration";

/**
 * Inventory movements from InventTransV5 (inventory transactions), one calendar month per call so a large company
 * (hundreds of thousands of transactions) never hits one request's time limit.
 * Transactions are summed per item, day and update type before they are stored:
 *   fin = 1  financially updated (Purchased / Sold): date = DateFinancial, value = CostAmountPosted + CostAmountAdjustment
 *   fin = 0  physically updated only (Received / Deducted): date = DatePhysical, value = CostAmountPhysical
 * This is the same basis D365 uses for the inventory value and the Inventory aging report (physical + financial).
 */
const E = "Microsoft.Dynamics.DataEntities.";
const SELECT = ["ItemId", "Qty", "DateFinancial", "DatePhysical", "CostAmountPosted", "CostAmountAdjustment", "CostAmountPhysical", "StatusIssue", "StatusReceipt"];
const d = (v: unknown) => String(v ?? "").slice(0, 10);
const NONE = "1900-01-01";

export function monthRange(from: string, to: string) {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while ((y < ey || (y === ey && m <= em)) && out.length < 600) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
const lastDay = (month: string) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);

/** Sync the financial lines of one month ("YYYY-MM") or of everything before a day ("before:YYYY-MM-DD"),
    or "physical" = every line that is only physically updated (received / deducted, not yet invoiced). Physical lines are
    reloaded as a whole each time because they turn financial when invoiced, possibly in another month. */
export async function syncInventMonth(company: string, month: string) {
  const map = await getSetting<Record<string, string>>("d365_map");
  const entitySet = mappedEntity(map, "InventTransV5");
  const physical = month === "physical";
  let filter: string, delFrom = "0001-01-01", delTo = "9999-12-31";
  if (physical) {
    filter = `DateFinancial le ${NONE}T23:59:59Z and DatePhysical gt ${NONE}T23:59:59Z and (StatusReceipt eq ${E}StatusReceipt'Received' or StatusIssue eq ${E}StatusIssue'Deducted')`;
  } else if (month.startsWith("before:")) {
    const b = month.slice(7);
    filter = `DateFinancial gt ${NONE}T23:59:59Z and DateFinancial lt ${b}T00:00:00Z`;
    delTo = new Date(Date.parse(b) - 86400000).toISOString().slice(0, 10);
  } else {
    delFrom = `${month}-01`; delTo = lastDay(month);
    filter = `DateFinancial ge ${delFrom}T00:00:00Z and DateFinancial le ${delTo}T23:59:59Z`;
  }
  const recs = await readAll(entitySet, { company, select: SELECT, filter });
  const agg = new Map<string, { item: string; day: string; fin: number; rq: number; rv: number; iq: number; iv: number; n: number }>();
  for (const r of recs) {
    const f = physical ? 0 : 1;
    const item = String(r.ItemId ?? ""), day = d(physical ? r.DatePhysical : r.DateFinancial);
    const qty = Number(r.Qty) || 0;
    const val = physical ? Number(r.CostAmountPhysical) || 0 : (Number(r.CostAmountPosted) || 0) + (Number(r.CostAmountAdjustment) || 0);
    const k = `${item}|${day}`;
    const e = agg.get(k) ?? { item, day, fin: f, rq: 0, rv: 0, iq: 0, iv: 0, n: 0 };
    if (qty > 0 || (qty === 0 && val >= 0)) { e.rq += qty; e.rv += val; } else { e.iq -= qty; e.iv -= val; }
    e.n++; agg.set(k, e);
  }
  const rows = [...agg.values()].map((e) => ({ company, ...e }));
  await sql.begin(async (tx) => {
    await tx`delete from d365.invent_mov where company = ${company} and fin = ${physical ? 0 : 1} and day between ${delFrom} and ${delTo}`;
    for (let i = 0; i < rows.length; i += 1000) await tx`insert into d365.invent_mov ${tx(rows.slice(i, i + 1000), "company", "item", "day", "fin", "rq", "rv", "iq", "iv", "n")}`;
    await tx`insert into d365.invent_mov_runs (company, month, rows, trans) values (${company}, ${month}, ${rows.length}, ${recs.length})
      on conflict (company, month) do update set rows = excluded.rows, trans = excluded.trans, at = now()`;
  });
  return { company, month, trans: recs.length, rows: rows.length };
}

/** Months already loaded for a company, and the date range they cover. */
export async function inventMovStatus(company: string) {
  const runs = await sql<{ month: string; rows: number; trans: number; at: Date }[]>`select month, rows, trans, at from d365.invent_mov_runs where company = ${company} order by month`;
  const [r] = await sql<{ first: string | null; last: string | null; n: number }[]>`select min(day)::text first, max(day)::text last, count(*)::int n from d365.invent_mov where company = ${company}`;
  return { runs, ...r };
}
