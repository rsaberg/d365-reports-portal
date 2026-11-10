import "server-only";
import { sql } from "../db";
import type { Ctx, ReportDef, Spec as BaseSpec } from "./modules";

export interface OptionSpec { label: string; href: string; active?: boolean; sep?: boolean }
type Spec = BaseSpec & { options?: OptionSpec[] };

/* Inventory movement and aging from D365 inventory transactions (d365.invent_mov, loaded from InventTransV5).
   Basis (same as D365 Inventory value / Inventory aging reports, "include physical"):
     financial lines  dated DateFinancial, value = posted + adjustment cost amounts
     physical-only    dated DatePhysical, value = physical cost amount (received / deducted, not yet invoiced)
   ?basis=fin keeps financial lines only (D365 "financial" view).  ?grp=<item group>  ?find=<text>  ?item=<item> (detail). */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const S = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0); };
const N = (x: number) => Math.round(x).toLocaleString("en-US");
const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const qs = (c: Ctx, extra: Record<string, string | undefined>) => {
  const q = new URLSearchParams({ company: c.company, from: c.from, to: c.to });
  for (const k of ["basis", "grp", "find"]) if (c.q[k]) q.set(k, String(c.q[k]));
  for (const [k, v] of Object.entries(extra)) v == null || v === "" ? q.delete(k) : q.set(k, v);
  return `?${q}`;
};

async function loaded(c: Ctx) {
  try {
    const [r] = await sql<{ n: number; first: string | null; last: string | null }[]>`select count(*)::int n, min(day)::text first, max(day)::text last from d365.invent_mov where company = ${c.company}`;
    return r;
  } catch { return { n: 0, first: null, last: null }; } // table not created yet (first inventory load runs the migration)
}
const notLoaded = (): Spec => ({
  kpis: [{ label: "Inventory transactions", value: "Not loaded", tone: "warn" }],
  note: "Load the inventory transactions first: Administration › Data sync › Inventory transactions (InventTransV5), from the first month of stock up to today. The report then reads the same lines D365 uses for the Inventory value and Inventory aging reports.",
});

/** Options rendered as chips above the report. */
function options(c: Ctx, r: string, groups: string[]) {
  const fin = c.q.basis === "fin";
  return [
    { label: "Physical + financial", href: qs(c, { r, basis: undefined }), active: !fin },
    { label: "Financial only", href: qs(c, { r, basis: "fin" }), active: fin },
    { label: "All groups", href: qs(c, { r, grp: undefined }), active: !c.q.grp, sep: true },
    ...groups.map((g) => ({ label: g, href: qs(c, { r, grp: g }), active: c.q.grp === g })),
  ];
}

async function groups(c: Ctx) {
  const rows = await sql<{ g: string }[]>`select distinct coalesce(nullif(p.item_group,''),'No group') g from d365.invent_mov m
    left join d365.products p on p.company = m.company and p.item = m.item where m.company = ${c.company} order by 1 limit 40`;
  return rows.map((r) => r.g);
}

/* ---------------------------------------------------------------- Movement summary */
const movement: ReportDef & { run: (c: Ctx) => Promise<Spec> } = { key: "stockmove", label: "Inventory movement (D365)", run: async (c) => {
  const st = await loaded(c);
  if (!st.n) return notLoaded();
  const fin = c.q.basis === "fin" ? 1 : 0; // 1 = financial only
  const grp = c.q.grp || null, find = c.q.find ? `%${String(c.q.find).toLowerCase()}%` : null;
  if (c.q.item) return detail(c, String(c.q.item), fin, st.first!);
  const rows = await sql<any[]>`
    select m.item, coalesce(max(p.name), m.item) name, coalesce(max(nullif(p.item_group,'')),'No group') item_group, coalesce(max(p.unit),'') unit,
      sum(case when m.day < ${c.from} then m.rq - m.iq else 0 end)::float open_qty, sum(case when m.day < ${c.from} then m.rv - m.iv else 0 end)::float open_val,
      sum(case when m.day >= ${c.from} then m.rq else 0 end)::float in_qty, sum(case when m.day >= ${c.from} then m.rv else 0 end)::float in_val,
      sum(case when m.day >= ${c.from} then m.iq else 0 end)::float out_qty, sum(case when m.day >= ${c.from} then m.iv else 0 end)::float out_val,
      sum(m.rq - m.iq)::float close_qty, sum(m.rv - m.iv)::float close_val
    from d365.invent_mov m left join d365.products p on p.company = m.company and p.item = m.item
    where m.company = ${c.company} and m.day <= ${c.to} and (${fin} = 0 or m.fin = 1)
      and (${grp}::text is null or coalesce(nullif(p.item_group,''),'No group') = ${grp})
      and (${find}::text is null or lower(m.item) like ${find} or lower(coalesce(p.name,'')) like ${find})
    group by m.item order by m.item`;
  const z = (x: number) => Math.abs(x) < 0.005;
  const list = rows.filter((r) => !(z(r.open_qty) && z(r.open_val) && z(r.in_qty) && z(r.out_qty) && z(r.in_val) && z(r.out_val) && z(r.close_qty) && z(r.close_val)))
    .map((r) => ({ ...r, avg_cost: Math.abs(r.close_qty) > 0.0001 ? r.close_val / r.close_qty : null }));
  const monthly = await sql<{ m: string; rv: number; iv: number }[]>`
    select to_char(m.day,'YYYY-MM') m, sum(m.rv)::float rv, sum(m.iv)::float iv from d365.invent_mov m left join d365.products p on p.company = m.company and p.item = m.item
    where m.company = ${c.company} and m.day between ${c.from} and ${c.to} and (${fin} = 0 or m.fin = 1)
      and (${grp}::text is null or coalesce(nullif(p.item_group,''),'No group') = ${grp}) group by 1 order by 1`;
  const byGroup = [...list.reduce((m, r) => m.set(r.item_group, (m.get(r.item_group) ?? 0) + r.close_val), new Map<string, number>())]
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12);
  const T = (k: string) => sum(list, k);
  const check = T("open_val") + T("in_val") - T("out_val") - T("close_val");
  return {
    options: options(c, "stockmove", await groups(c)),
    kpis: [
      { label: `Opening ${c.from}`, value: `${c.cur} ${S(T("open_val"))}`, note: `${N(T("open_qty"))} units` },
      { label: "Receipts", value: `${c.cur} ${S(T("in_val"))}`, note: `${N(T("in_qty"))} units`, tone: "good" },
      { label: "Issues", value: `${c.cur} ${S(T("out_val"))}`, note: `${N(T("out_qty"))} units`, tone: "bad" },
      { label: `Closing ${c.to}`, value: `${c.cur} ${S(T("close_val"))}`, note: `${N(T("close_qty"))} units` },
      { label: "Items with movement", value: N(list.length), note: Math.abs(check) < 1 ? "opening + in − out = closing ✓" : `difference ${S(check)}` },
    ],
    charts: [
      { title: "Receipts vs issues by month (value)", kind: "pair", money: true, a: { key: "in", name: "Receipts" }, b: { key: "out", name: "Issues" },
        data: monthly.map((r) => ({ label: `${MON[+r.m.slice(5, 7) - 1]} ${r.m.slice(2, 4)}`, in: r.rv, out: r.iv })) },
      { title: `Closing value by item group · ${c.to}`, kind: "rank", money: true, data: byGroup },
    ],
    tables: [{
      title: "Total item movement — opening, receipts, issues, closing", sub: `${c.from} – ${c.to} · quantity and value in ${c.cur} · click an item for its transactions by day`,
      rows: list,
      total: { item: "Total", open_qty: T("open_qty"), open_val: T("open_val"), in_qty: T("in_qty"), in_val: T("in_val"), out_qty: T("out_qty"), out_val: T("out_val"), close_qty: T("close_qty"), close_val: T("close_val") },
      cols: [
        { key: "item", label: "Item", href: qs(c, { r: "stockmove" }) + "&item={item}" }, { key: "name", label: "Name" }, { key: "item_group", label: "Group" }, { key: "unit", label: "Unit" },
        { key: "open_qty", label: "Opening qty", type: "num" }, { key: "open_val", label: "Opening value", type: "money" },
        { key: "in_qty", label: "Receipts qty", type: "num" }, { key: "in_val", label: "Receipts value", type: "money" },
        { key: "out_qty", label: "Issues qty", type: "num" }, { key: "out_val", label: "Issues value", type: "money" },
        { key: "close_qty", label: "Closing qty", type: "num" }, { key: "close_val", label: "Closing value", type: "money" }, { key: "avg_cost", label: "Avg cost", type: "money" },
      ],
    }],
    note: `Source: D365 inventory transactions (InventTransV5), loaded ${st.first} – ${st.last}. ${fin ? "Financial lines only (invoiced / posted)." : "Physical + financial: received and deducted lines not yet invoiced are included at their physical cost, as in D365 with “Include physical” on."} Reconcile: closing quantity and value = D365 Inventory management › Inquiries and reports › Inventory aging report (As of date ${c.to}, View: Item number) and the Inventory value report for the same period. Cost adjustments from inventory close are dated on the adjusted transaction’s financial date; adjustments posted after ${c.to} for earlier lines can make a small difference until the next load.`,
  };
} };

async function detail(c: Ctx, item: string, fin: number, first: string): Promise<Spec> {
  const [p] = await sql<{ name: string; item_group: string; unit: string }[]>`select name, item_group, unit from d365.products where company = ${c.company} and item = ${item}`;
  const [o] = await sql<{ q: number; v: number }[]>`select coalesce(sum(rq - iq),0)::float q, coalesce(sum(rv - iv),0)::float v from d365.invent_mov where company = ${c.company} and item = ${item} and day < ${c.from} and (${fin} = 0 or fin = 1)`;
  const days = await sql<{ day: string; fin: number; rq: number; rv: number; iq: number; iv: number; n: number }[]>`
    select day::text, fin, rq::float, rv::float, iq::float, iv::float, n from d365.invent_mov where company = ${c.company} and item = ${item}
      and day between ${c.from} and ${c.to} and (${fin} = 0 or fin = 1) order by day, fin desc`;
  let q = o.q, v = o.v;
  const rows = [{ day: c.from, kind: "Opening balance", in_qty: null, in_val: null, out_qty: null, out_val: null, bal_qty: q, bal_val: v, n: null } as any];
  for (const d of days) { q += d.rq - d.iq; v += d.rv - d.iv; rows.push({ day: d.day, kind: d.fin ? "Financial" : "Physical (not invoiced)", in_qty: d.rq || null, in_val: d.rv || null, out_qty: d.iq || null, out_val: d.iv || null, bal_qty: q, bal_val: v, n: d.n }); }
  return {
    options: [{ label: "← All items", href: qs(c, { r: "stockmove", item: undefined }), active: false }],
    kpis: [
      { label: item, value: p?.name || item, note: [p?.item_group, p?.unit].filter(Boolean).join(" · ") },
      { label: "Opening", value: N(o.q), note: `${c.cur} ${S(o.v)}` },
      { label: "Receipts", value: N(sum(days, "rq")), note: `${c.cur} ${S(sum(days, "rv"))}`, tone: "good" },
      { label: "Issues", value: N(sum(days, "iq")), note: `${c.cur} ${S(sum(days, "iv"))}`, tone: "bad" },
      { label: "Closing", value: N(q), note: `${c.cur} ${S(v)}` },
    ],
    tables: [{ title: `Item ${item} by day with running balance`, sub: `${c.from} – ${c.to} · data from ${first}`, rows,
      cols: [{ key: "day", label: "Date", type: "date" }, { key: "kind", label: "Update" }, { key: "n", label: "Lines", type: "int" },
        { key: "in_qty", label: "In qty", type: "num" }, { key: "in_val", label: "In value", type: "money" }, { key: "out_qty", label: "Out qty", type: "num" }, { key: "out_val", label: "Out value", type: "money" },
        { key: "bal_qty", label: "Balance qty", type: "num" }, { key: "bal_val", label: "Balance value", type: "money" }] }],
  };
}

/* ---------------------------------------------------------------- Aging (D365 method) */
const BUCKETS: [string, number][] = [["0–30 days", 30], ["31–60", 60], ["61–90", 90], ["91–180", 180], ["181–365", 365], ["Over 1 year", Infinity]];
const aging: ReportDef & { run: (c: Ctx) => Promise<Spec> } = { key: "aging", label: "Inventory aging (D365)", run: async (c) => {
  const st = await loaded(c);
  if (!st.n) return notLoaded();
  const fin = c.q.basis === "fin" ? 1 : 0;
  const grp = c.q.grp || null, at = c.asOf;
  // On-hand at the as-of date is allocated to the latest receipts first (D365 Inventory aging), each receipt aged from its date.
  const alloc = await sql<{ item: string; day: string; aq: number }[]>`
    with m as (select m.* from d365.invent_mov m left join d365.products p on p.company = m.company and p.item = m.item
        where m.company = ${c.company} and m.day <= ${at} and (${fin} = 0 or m.fin = 1) and (${grp}::text is null or coalesce(nullif(p.item_group,''),'No group') = ${grp})),
      bal as (select item, sum(rq - iq) bq from m group by item having sum(rq - iq) > 0.0001),
      rc as (select item, day, sum(rq) q from m where rq > 0 group by item, day),
      cu as (select rc.item, rc.day, rc.q, b.bq, sum(rc.q) over (partition by rc.item order by rc.day desc rows unbounded preceding) cum from rc join bal b using (item))
    select item, day::text, least(q, bq - (cum - q))::float aq from cu where cum - q < bq`;
  const bal = await sql<{ item: string; name: string; item_group: string; unit: string; q: number; v: number }[]>`
    select m.item, coalesce(max(p.name), m.item) name, coalesce(max(nullif(p.item_group,'')),'No group') item_group, coalesce(max(p.unit),'') unit, sum(m.rq - m.iq)::float q, sum(m.rv - m.iv)::float v
    from d365.invent_mov m left join d365.products p on p.company = m.company and p.item = m.item
    where m.company = ${c.company} and m.day <= ${at} and (${fin} = 0 or m.fin = 1) and (${grp}::text is null or coalesce(nullif(p.item_group,''),'No group') = ${grp})
    group by m.item having abs(sum(m.rq - m.iq)) > 0.0001 or abs(sum(m.rv - m.iv)) > 0.005 order by m.item`;
  const per = new Map<string, number[]>();
  const t0 = Date.parse(at);
  for (const a of alloc) {
    const age = Math.round((t0 - Date.parse(a.day)) / 86400000);
    const i = BUCKETS.findIndex(([, lim]) => age <= lim);
    const e = per.get(a.item) ?? BUCKETS.map(() => 0); e[i] += a.aq; per.set(a.item, e);
  }
  const rows = bal.map((b) => {
    const e = per.get(b.item) ?? BUCKETS.map(() => 0);
    const got = e.reduce((x, y) => x + y, 0);
    if (b.q > 0 && got < b.q - 0.0001) e[e.length - 1] += b.q - got; // on hand older than the loaded history
    const unit = Math.abs(b.q) > 0.0001 ? b.v / b.q : 0;
    const r: any = { item: b.item, name: b.name, item_group: b.item_group, unit: b.unit, qty: b.q, value: b.v, avg_cost: unit };
    BUCKETS.forEach((_, i) => { r[`q${i}`] = b.q > 0 ? e[i] : 0; r[`v${i}`] = b.q > 0 ? e[i] * unit : 0; });
    if (b.q <= 0) r[`v${BUCKETS.length - 1}`] = b.v; // negative or zero stock with value left: shown in the last bucket
    return r;
  });
  const tot: any = { item: "Total", qty: sum(rows, "qty"), value: sum(rows, "value") };
  BUCKETS.forEach((_, i) => { tot[`q${i}`] = sum(rows, `q${i}`); tot[`v${i}`] = sum(rows, `v${i}`); });
  const old = tot.v4 + tot.v5;
  return {
    options: options(c, "aging", await groups(c)),
    kpis: [
      { label: `Inventory value ${at}`, value: `${c.cur} ${S(tot.value)}`, note: `${N(tot.qty)} units · ${N(rows.length)} items` },
      { label: "0–90 days", value: `${c.cur} ${S(tot.v0 + tot.v1 + tot.v2)}`, tone: "good" },
      { label: "91–365 days", value: `${c.cur} ${S(tot.v3 + tot.v4)}`, tone: "warn" },
      { label: "Over 1 year", value: `${c.cur} ${S(tot.v5)}`, note: tot.value ? `${((tot.v5 / tot.value) * 100).toFixed(1)}% of value` : undefined, tone: "bad" },
      { label: "Older than 180 days", value: `${c.cur} ${S(old)}`, note: "candidates for provision" },
    ],
    charts: [{ title: `Value by age · ${at}`, kind: "bucket", money: true, data: BUCKETS.map(([label], i) => ({ label, value: tot[`v${i}`] })) }],
    tables: [{
      title: "Inventory aging by item", sub: `as of ${at} · on-hand allocated to the latest receipts first · value at average cost`, rows, total: tot,
      cols: [{ key: "item", label: "Item", href: qs(c, { r: "stockmove" }) + "&item={item}" }, { key: "name", label: "Name" }, { key: "item_group", label: "Group" },
        { key: "qty", label: "On-hand qty", type: "num" }, { key: "value", label: "Value", type: "money" },
        ...BUCKETS.flatMap(([label], i) => [{ key: `q${i}`, label: `${label} qty`, type: "num" as const }, { key: `v${i}`, label: `${label} value`, type: "money" as const }])],
    }],
    note: `Same method as D365 Inventory aging report (Inventory management › Inquiries and reports): the quantity on hand at the as-of date is matched to the most recent receipts, and each receipt is aged from its date; value = quantity × average cost at that date. Totals equal the closing balance of “Inventory movement (D365)” for the same date. Use As of date = ${at}, View = Item number, periods 30/60/90/180/365 days in D365 to compare. Data loaded ${st.first} – ${st.last}.`,
  };
} };

export const STOCK_REPORTS: ReportDef[] = [movement, aging];
