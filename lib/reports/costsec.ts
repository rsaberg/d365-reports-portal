import "server-only";
import { sql } from "../db";
import type { Ctx, ModuleDef } from "./modules";
import type { DashSpec } from "./dashtypes";
import type { DashDef } from "./dashboards";

/* Cost accounting and D365 security (users & roles): dashboards and reports.
   Cost figures use the demo item costs, purchase lines and production output until the cost entities are synced.
   Security reads d365.sec_* (SystemUsers / SecurityRoles / SecurityUserRoles); when the role entities are not readable
   a demo set of standard roles is assigned to the real users (mode = 'Demo'). */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ml = (m: string) => MON[+m.slice(5, 7) - 1];
const months = (from: string, to: string) => {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out.slice(-24);
};
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const group = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) =>
  [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + (Number(val(r)) || 0)), new Map<string, number>())].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
const ratio = (a: number, b: number) => (b ? a / b : 0);
const N = (x: number) => Math.round(x).toLocaleString("en-US");
const P = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–");
const S = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0); };
const inP = (d: string | null | undefined, f: string, t: string) => !!d && d >= f && d <= t;
const link = (c: Ctx, path: string, r?: string) => { const q = new URLSearchParams({ company: c.company, from: c.from, to: c.to }); if (r) q.set("r", r); return `${path}?${q}`; };
const L = (c: Ctx, path: string, label: string, r?: string) => ({ href: link(c, path, r), label });

/* ================================================================== Cost accounting */
const salesCost = (c: Ctx, from: string, to: string) => sql<{ item: string; name: string; grp: string; m: string; qty: number; sales: number; cost: number; unit: number }[]>`
  select coalesce(nullif(l.item,''),'(no item)') item, coalesce(max(i.name), max(l.item_name), l.item, 'Non-stock') name, coalesce(max(nullif(i.item_group,'')),'No group') grp,
    to_char(l.invoice_date,'YYYY-MM') m, sum(l.qty)::float qty, sum(l.line_amount)::float sales,
    sum(l.qty * coalesce(i.unit_cost, l.price * 0.65))::float cost, coalesce(max(i.unit_cost),0)::float unit
  from d365.invoice_lines l left join d365.demo_items i on i.company = l.company and i.item = l.item
  where l.company = ${c.company} and l.invoice_date between ${from} and ${to} and l.currency = ${c.cur} group by l.item, 4`;
const purchCost = (c: Ctx) => sql<{ purchase_order: string; vendor: string; item: string; name: string; grp: string; order_date: string; qty: number; price: number; std: number }[]>`
  select l.purchase_order, coalesce(v.name, l.vendor) vendor, l.item, coalesce(i.name, l.item) name, coalesce(nullif(i.item_group,''),'No group') grp,
    l.order_date::text, l.qty::float, l.price::float, coalesce(i.unit_cost, l.price)::float std
  from d365.demo_purch_lines l left join d365.demo_vendors v on v.company = l.company and v.vendor = l.vendor left join d365.demo_items i on i.company = l.company and i.item = l.item
  where l.company = ${c.company}`;
const prodCost = (c: Ctx) => sql<{ prod_order: string; item: string; status: number; qty: number; qty_done: number; plan: number; actual: number; finished: string | null; unit: number }[]>`
  select p.prod_order, p.item, p.status, p.qty::float, coalesce(o.qty_done,0)::float qty_done, coalesce(o.material_plan,0)::float plan, coalesce(o.material_actual,0)::float actual,
    o.finished_date::text finished, coalesce(i.unit_cost,0)::float unit
  from d365.prod_orders p left join d365.demo_prod_output o on o.company = p.company and o.prod_order = p.prod_order
    left join d365.demo_items i on i.company = p.company and i.item = p.item where p.company = ${c.company}`;
const stockValue = (c: Ctx, at: string) => sql<{ item: string; grp: string; warehouse: string; qty: number; value: number }[]>`
  select t.item, coalesce(nullif(i.item_group,''),'No group') grp, t.warehouse, sum(t.qty)::float qty, sum(t.cost_amount)::float value
  from d365.demo_invent_trans t left join d365.demo_items i on i.company = t.company and i.item = t.item
  where t.company = ${c.company} and t.trans_date <= ${at} group by 1,2,3 having sum(t.qty) > 0.0001`;
/** Production cost: standard = produced qty × item cost; actual scales by material used ÷ BOM standard. */
const pc = (r: { qty_done: number; plan: number; actual: number; unit: number }) => { const std = r.qty_done * r.unit; return { std, act: r.plan ? std * (r.actual / r.plan) : std }; };

const costDash: DashDef = { title: "Cost accounting", sub: "Cost of sales, item costs, purchase price and production variances, stock value", demo: true, run: async (c): Promise<DashSpec> => {
  const sc = await salesCost(c, c.from, c.to), scP = await salesCost(c, c.s.prevFrom, c.s.prevTo);
  const pl = [...(await purchCost(c))];
  const pr = [...(await prodCost(c))];
  const st = await stockValue(c, c.asOf);
  const plC = pl.filter((r) => inP(r.order_date, c.from, c.to)), plP = pl.filter((r) => inP(r.order_date, c.s.prevFrom, c.s.prevTo));
  const ppv = (x: { price: number; std: number; qty: number }[]) => sum(x, (r) => (r.price - r.std) * r.qty);
  const fin = pr.filter((r) => inP(r.finished, c.from, c.to)), finP = pr.filter((r) => inP(r.finished, c.s.prevFrom, c.s.prevTo));
  const pv = (x: { qty_done: number; plan: number; actual: number; unit: number }[]) => sum(x, (r) => pc(r).act - pc(r).std);
  const cogs = sum(sc, (r) => r.cost), cogsP = sum(scP, (r) => r.cost), sales = sum(sc, (r) => r.sales), salesP = sum(scP, (r) => r.sales);
  const byItem = group(sc, (r) => r.name, (r) => r.cost).slice(0, 10);
  return {
    tiles: [
      { label: "Cost of sales", value: cogs, fmt: "money", prev: cogsP, icon: "money", href: link(c, "/m/cost", "cogs") },
      { label: "Cost ÷ sales", value: ratio(cogs, sales), fmt: "pct", prev: salesP ? cogsP / salesP : null, icon: "pie" },
      { label: "Stock value", value: sum(st, (r) => r.value), fmt: "money", icon: "box", href: link(c, "/m/cost", "groups") },
      { label: "Purchase price variance", value: ppv(plC), fmt: "money", prev: plP.length ? ppv(plP) : null, icon: "cart", href: link(c, "/m/cost", "ppv") },
      { label: "Production variance", value: pv(fin), fmt: "money", prev: finP.length ? pv(finP) : null, icon: "factory", href: link(c, "/m/cost", "production") },
      { label: "Items costed", value: new Set(sc.map((r) => r.item)).size, fmt: "int", prev: new Set(scP.map((r) => r.item)).size || null, icon: "tag", href: link(c, "/m/cost", "items") },
    ],
    cards: [
      { title: "Sales vs cost of sales", body: { kind: "pair", money: true, data: months(c.from, c.to).map((m) => ({ label: ml(m), sales: sum(sc.filter((r) => r.m === m), (r) => r.sales), cost: sum(sc.filter((r) => r.m === m), (r) => r.cost) })), a: { key: "cost", name: "Cost of sales" }, b: { key: "sales", name: "Sales" } } },
      { title: "Cost of sales by item group", link: L(c, "/m/cost", "By group", "groups"), body: { kind: "donut", money: true, data: group(sc, (r) => r.grp, (r) => r.cost), centerLabel: `Cost of sales (${c.cur})` } },
      { title: "Top 10 items by cost of sales", link: L(c, "/m/cost", "All items", "cogs"), body: { kind: "bars", cols: ["Item", "Margin", `Cost (${c.cur})`], rows: byItem.map((g) => { const r = sc.filter((x) => x.name === g.label); return { a: g.label, b: P(1 - ratio(sum(r, (x) => x.cost), sum(r, (x) => x.sales))), value: g.value }; }) } },
      { title: "Purchase price variance by vendor", link: L(c, "/m/cost", "PPV", "ppv"),
        stats: [{ label: "Lines", value: N(plC.length) }, { label: "Above standard", value: N(plC.filter((r) => r.price > r.std).length), tone: "bad" }, { label: "Variance", value: S(ppv(plC)), tone: ppv(plC) > 0 ? "bad" : "good" }],
        body: { kind: "rank", money: true, data: group(plC, (r) => r.vendor, (r) => (r.price - r.std) * r.qty).filter((g) => g.value > 0).slice(0, 8) } },
      { title: "Production cost: standard vs actual", link: L(c, "/m/cost", "Order costing", "production"),
        stats: [{ label: "Standard", value: S(sum(fin, (r) => pc(r).std)) }, { label: "Actual", value: S(sum(fin, (r) => pc(r).act)) }, { label: "Variance", value: P(ratio(pv(fin), sum(fin, (r) => pc(r).std))), tone: pv(fin) > 0 ? "bad" : "good" }],
        body: { kind: "pair", money: true, data: group(fin, (r) => r.item, (r) => pc(r).std).slice(0, 6).map((g) => ({ label: g.label, std: g.value, act: sum(fin.filter((r) => r.item === g.label), (r) => pc(r).act) })), a: { key: "std", name: "Standard" }, b: { key: "act", name: "Actual" } } },
      { title: "Stock value by warehouse", body: { kind: "rank", money: true, data: group(st, (r) => r.warehouse || "Not set", (r) => r.value).slice(0, 10) } },
    ],
    strip: [{ label: "Avg unit cost sold", value: S(ratio(cogs, sum(sc, (r) => r.qty))) }, { label: "Purchase lines", value: N(plC.length) }, { label: "Production orders finished", value: N(fin.length) }, { label: "Item groups", value: N(new Set(sc.map((r) => r.grp)).size) }],
    note: "Costs use the demo item costs (standard) until the D365 cost entities are synced; actual production cost scales the standard by material used vs BOM.",
  };
} };

const cost: ModuleDef = { key: "cost", title: "Cost accounting", sub: "Item costs, cost of sales, purchase price variance, production costing and cost by item group", reports: [
  { key: "items", label: "Item cost list", demo: true, run: async (c) => {
    const items = await sql<{ item: string; name: string; grp: string; unit: number }[]>`select item, coalesce(name,item) name, coalesce(nullif(item_group,''),'No group') grp, unit_cost::float unit from d365.demo_items where company = ${c.company}`;
    const pl = (await purchCost(c)).filter((r) => r.order_date <= c.to);
    const st = await stockValue(c, c.asOf);
    const rows = items.map((i) => {
      const p = pl.filter((r) => r.item === i.item).sort((a, b) => a.order_date.localeCompare(b.order_date));
      const per = p.filter((r) => r.order_date >= c.from);
      const avg = ratio(sum(per, (r) => r.price * r.qty), sum(per, (r) => r.qty));
      const last = p.length ? p[p.length - 1] : null;
      const s = st.filter((r) => r.item === i.item);
      return { item: i.item, name: i.name, grp: i.grp, unit: i.unit, avg: avg || null, last: last?.price ?? null, last_date: last?.order_date ?? null, diff: last && i.unit ? last.price / i.unit - 1 : null, qty: sum(s, (r) => r.qty), value: sum(s, (r) => r.value) };
    }).sort((a, b) => b.value - a.value);
    return { kpis: [{ label: "Items", value: N(rows.length) }, { label: "Avg standard cost", value: S(ratio(sum(rows, (r) => r.unit), rows.length)) }, { label: "Last price above standard", value: N(rows.filter((r) => (r.diff ?? 0) > 0.005).length), tone: "warn" }, { label: "Stock value", value: S(sum(rows, (r) => r.value)) }],
      tables: [{ title: "Cost per item", sub: "standard cost vs purchase prices", rows, total: { item: "Total", value: sum(rows, (r) => r.value) }, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "grp", label: "Group" },
        { key: "unit", label: "Standard cost", type: "money" }, { key: "avg", label: "Avg purchase price", type: "money" }, { key: "last", label: "Last price", type: "money" }, { key: "last_date", label: "Last purchase", type: "date" },
        { key: "diff", label: "Last vs standard", type: "pct", tone: "signed" }, { key: "qty", label: "On hand", type: "num" }, { key: "value", label: "Stock value", type: "money" }] }] };
  } },
  { key: "cogs", label: "Cost of sales by item", demo: true, run: async (c) => {
    const sc = await salesCost(c, c.from, c.to);
    const m = new Map<string, any>();
    for (const r of sc) { const x = m.get(r.item) ?? { item: r.item, name: r.name, grp: r.grp, qty: 0, sales: 0, cost: 0 }; x.qty += r.qty; x.sales += r.sales; x.cost += r.cost; m.set(r.item, x); }
    const rows = [...m.values()].map((x) => ({ ...x, unit: ratio(x.cost, x.qty), gp: x.sales - x.cost, gm: ratio(x.sales - x.cost, x.sales) })).sort((a, b) => b.cost - a.cost);
    const cogs = sum(rows, (r) => r.cost), sales = sum(rows, (r) => r.sales);
    return { kpis: [{ label: "Cost of sales", value: `${c.cur} ${S(cogs)}` }, { label: "Sales", value: `${c.cur} ${S(sales)}` }, { label: "Gross margin", value: P(ratio(sales - cogs, sales)), tone: "good" }, { label: "Items sold", value: N(rows.length) }],
      charts: [{ title: "Cost of sales by item group", kind: "rank", money: true, data: group(rows, (r) => r.grp, (r) => r.cost).slice(0, 10) }],
      tables: [{ title: "Cost of sales per item", rows, total: { item: "Total", sales, cost: cogs, gp: sales - cogs }, cols: [{ key: "item", label: "Item" }, { key: "name", label: "Name" }, { key: "grp", label: "Group" }, { key: "qty", label: "Qty", type: "num" },
        { key: "unit", label: "Unit cost", type: "money" }, { key: "cost", label: "Cost of sales", type: "money" }, { key: "sales", label: "Sales", type: "money" }, { key: "gp", label: "Gross profit", type: "money", tone: "signed" }, { key: "gm", label: "Margin", type: "pct" }] }] };
  } },
  { key: "ppv", label: "Purchase price variance", demo: true, run: async (c) => {
    const rows = (await purchCost(c)).filter((r) => inP(r.order_date, c.from, c.to)).map((r) => ({ ...r, var_unit: r.price - r.std, var: (r.price - r.std) * r.qty, var_pct: r.std ? r.price / r.std - 1 : null })).sort((a, b) => b.var - a.var);
    return { kpis: [{ label: "Purchase lines", value: N(rows.length) }, { label: "Total variance", value: `${c.cur} ${S(sum(rows, (r) => r.var))}`, tone: sum(rows, (r) => r.var) > 0 ? "bad" : "good" }, { label: "Unfavourable", value: `${c.cur} ${S(sum(rows.filter((r) => r.var > 0), (r) => r.var))}`, tone: "bad" }, { label: "Favourable", value: `${c.cur} ${S(sum(rows.filter((r) => r.var < 0), (r) => r.var))}`, tone: "good" }],
      charts: [{ title: "Variance by vendor", kind: "rank", money: true, data: group(rows, (r) => r.vendor, (r) => r.var).slice(0, 10) }, { title: "Variance by item group", kind: "rank", money: true, data: group(rows, (r) => r.grp, (r) => r.var).slice(0, 10) }],
      tables: [{ title: "Purchase lines vs standard cost", rows, total: { purchase_order: "Total", var: sum(rows, (r) => r.var) }, cols: [{ key: "purchase_order", label: "PO" }, { key: "order_date", label: "Date", type: "date" }, { key: "vendor", label: "Vendor" }, { key: "name", label: "Item" },
        { key: "qty", label: "Qty", type: "num" }, { key: "std", label: "Standard", type: "money" }, { key: "price", label: "Price", type: "money" }, { key: "var_unit", label: "Variance / unit", type: "money", tone: "signed" }, { key: "var", label: "Variance", type: "money", tone: "signed" }, { key: "var_pct", label: "Variance %", type: "pct", tone: "signed" }] }] };
  } },
  { key: "production", label: "Production order costing", demo: true, run: async (c) => {
    const rows = (await prodCost(c)).filter((r) => inP(r.finished, c.from, c.to)).map((r) => { const x = pc(r); return { ...r, std: x.std, act: x.act, var: x.act - x.std, var_pct: ratio(x.act - x.std, x.std), unit_act: ratio(x.act, r.qty_done) }; }).sort((a, b) => b.var - a.var);
    return { kpis: [{ label: "Orders finished", value: N(rows.length) }, { label: "Standard cost", value: `${c.cur} ${S(sum(rows, (r) => r.std))}` }, { label: "Actual cost", value: `${c.cur} ${S(sum(rows, (r) => r.act))}` }, { label: "Variance", value: P(ratio(sum(rows, (r) => r.var), sum(rows, (r) => r.std))), tone: sum(rows, (r) => r.var) > 0 ? "bad" : "good" }],
      charts: [{ title: "Standard vs actual by item", kind: "pair", money: true, data: group(rows, (r) => r.item, (r) => r.std).slice(0, 8).map((g) => ({ label: g.label, std: g.value, act: sum(rows.filter((r) => r.item === g.label), (r) => r.act) })), a: { key: "std", name: "Standard" }, b: { key: "act", name: "Actual" } }],
      tables: [{ title: "Cost per production order", rows, total: { prod_order: "Total", std: sum(rows, (r) => r.std), act: sum(rows, (r) => r.act), var: sum(rows, (r) => r.var) }, cols: [{ key: "prod_order", label: "Order" }, { key: "item", label: "Item" }, { key: "finished", label: "Finished", type: "date" },
        { key: "qty_done", label: "Produced", type: "num" }, { key: "unit", label: "Std unit cost", type: "money" }, { key: "unit_act", label: "Actual unit cost", type: "money" }, { key: "std", label: "Standard cost", type: "money" }, { key: "act", label: "Actual cost", type: "money" },
        { key: "var", label: "Variance", type: "money", tone: "signed" }, { key: "var_pct", label: "Variance %", type: "pct", tone: "signed" }] }],
      note: "Actual cost = standard cost × material used ÷ BOM standard (demo output). Labour and overhead come with the cost entities." };
  } },
  { key: "groups", label: "Cost by item group", demo: true, run: async (c) => {
    const sc = await salesCost(c, c.from, c.to);
    const pl = (await purchCost(c)).filter((r) => inP(r.order_date, c.from, c.to));
    const st = await stockValue(c, c.asOf);
    const groups = [...new Set([...sc.map((r) => r.grp), ...pl.map((r) => r.grp), ...st.map((r) => r.grp)])];
    const rows = groups.map((g) => { const cogs = sum(sc.filter((r) => r.grp === g), (r) => r.cost); const stock = sum(st.filter((r) => r.grp === g), (r) => r.value);
      return { grp: g, purchases: sum(pl.filter((r) => r.grp === g), (r) => r.price * r.qty), ppv: sum(pl.filter((r) => r.grp === g), (r) => (r.price - r.std) * r.qty), cogs, sales: sum(sc.filter((r) => r.grp === g), (r) => r.sales), stock, turns: stock ? cogs / stock : null }; }).sort((a, b) => b.cogs - a.cogs);
    return { kpis: [{ label: "Item groups", value: N(rows.length) }, { label: "Cost of sales", value: `${c.cur} ${S(sum(rows, (r) => r.cogs))}` }, { label: "Purchases", value: `${c.cur} ${S(sum(rows, (r) => r.purchases))}` }, { label: "Stock value", value: `${c.cur} ${S(sum(rows, (r) => r.stock))}` }],
      charts: [{ title: "Cost of sales vs stock value", kind: "pair", money: true, data: rows.slice(0, 8).map((r) => ({ label: r.grp, cogs: r.cogs, stock: r.stock })), a: { key: "stock", name: "Stock value" }, b: { key: "cogs", name: "Cost of sales" } }],
      tables: [{ title: "Cost per item group", rows, total: { grp: "Total", purchases: sum(rows, (r) => r.purchases), ppv: sum(rows, (r) => r.ppv), cogs: sum(rows, (r) => r.cogs), sales: sum(rows, (r) => r.sales), stock: sum(rows, (r) => r.stock) },
        cols: [{ key: "grp", label: "Item group" }, { key: "purchases", label: "Purchases", type: "money" }, { key: "ppv", label: "Price variance", type: "money", tone: "signed" }, { key: "cogs", label: "Cost of sales", type: "money" }, { key: "sales", label: "Sales", type: "money" },
          { key: "stock", label: "Stock value", type: "money" }, { key: "turns", label: "Turns", type: "num" }] }] };
  } },
] };

/* ================================================================== Security (D365 users & roles) */
const ROLES: [string, string, string][] = [
  ["-SYSADMIN-", "System administrator", "Operations"], ["SECURITYADMINISTRATOR", "Security administrator", "Operations"],
  ["LEDGERACCOUNTANT", "Accountant", "Finance"], ["LEDGERACCOUNTINGMANAGER", "Accounting manager", "Finance"], ["BUDGETBUDGETMANAGER", "Budget manager", "Finance"], ["BANKCASHMANAGER", "Treasurer", "Finance"],
  ["VENDACCOUNTSPAYABLECLERK", "Accounts payable clerk", "Finance"], ["VENDACCOUNTSPAYABLEPAYMENTSCLERK", "Accounts payable payments clerk", "Finance"],
  ["CUSTACCOUNTSRECEIVABLECLERK", "Accounts receivable clerk", "Finance"], ["CUSTCREDITCOLLECTIONSMANAGER", "Credit and collections manager", "Finance"], ["COSTCOSTACCOUNTANT", "Cost accountant", "Finance"],
  ["SALESSALESCLERK", "Sales clerk", "SCM"], ["SALESSALESMANAGER", "Sales manager", "SCM"], ["PURCHPURCHASINGAGENT", "Purchasing agent", "SCM"], ["PURCHPURCHASINGMANAGER", "Purchasing manager", "SCM"],
  ["WHSWAREHOUSEMANAGER", "Warehouse manager", "SCM"], ["WHSWAREHOUSEWORKER", "Warehouse worker", "Activity"], ["PRODPRODUCTIONSUPERVISOR", "Production supervisor", "SCM"],
  ["EMPLOYEE", "Employee", "Team members"], ["SYSTEMUSER", "System user", "None"],
];
/** Pairs of roles one person should not hold together. */
const SOD: [string, string, string][] = [
  ["VENDACCOUNTSPAYABLECLERK", "VENDACCOUNTSPAYABLEPAYMENTSCLERK", "Enters vendor invoices and pays them"],
  ["PURCHPURCHASINGAGENT", "VENDACCOUNTSPAYABLECLERK", "Orders from vendors and enters their invoices"],
  ["PURCHPURCHASINGAGENT", "VENDACCOUNTSPAYABLEPAYMENTSCLERK", "Orders from vendors and pays them"],
  ["SALESSALESCLERK", "CUSTCREDITCOLLECTIONSMANAGER", "Sells and sets customer credit"],
  ["SALESSALESCLERK", "CUSTACCOUNTSRECEIVABLECLERK", "Sells and records customer payments"],
  ["LEDGERACCOUNTANT", "BANKCASHMANAGER", "Posts journals and manages bank payments"],
];
const PRIV = ["-SYSADMIN-", "SECURITYADMINISTRATOR"];
const LIC_ORDER = ["Operations", "Finance", "SCM", "Activity", "Team members", "None"];
const isService = (u: { user_id: string; name: string }) => /app|svc|service|pipeline|scaleunit|^cds|anonymous|^\$/i.test(u.user_id + " " + u.name);

/** Demo roles for the real users when D365 role assignments are not readable; rebuilt when the user list changes. */
async function ensureSecDemo() {
  const [k] = await sql<{ live: number; demo: number; orphan: number; users: number }[]>`
    select (select count(*) from d365.sec_user_roles where coalesce(mode,'') <> 'Demo')::int live, (select count(*) from d365.sec_user_roles where mode = 'Demo')::int demo,
      (select count(*) from d365.sec_user_roles r where mode = 'Demo' and not exists (select 1 from d365.sec_users u where u.user_id = r.user_id))::int orphan, (select count(*) from d365.sec_users)::int users`;
  if (k.live > 0 || !k.users || (k.demo > 0 && k.orphan === 0)) return;
  const [rk] = await sql<{ n: number }[]>`select count(*)::int n from d365.sec_roles`;
  if (!rk.n) await sql`insert into d365.sec_roles ${sql(ROLES.map(([role, name, license]) => ({ role, name, description: name, license })), "role", "name", "description", "license")}`;
  const users = await sql<{ user_id: string; name: string; email: string | null }[]>`select user_id, coalesce(name,user_id) name, email from d365.sec_users order by user_id`;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const biz = ROLES.filter(([r]) => !PRIV.includes(r) && r !== "EMPLOYEE" && r !== "SYSTEMUSER").map(([r]) => r);
  const out: { user_id: string; role: string; role_name: string; status: string; mode: string }[] = [];
  const add = (u: string, r: string) => { if (!out.some((x) => x.user_id === u && x.role === r)) out.push({ user_id: u, role: r, role_name: ROLES.find((x) => x[0] === r)![1], status: "Enabled", mode: "Demo" }); };
  for (const u of users) {
    add(u.user_id, "SYSTEMUSER");
    if (isService(u)) { if (rnd() < 0.5) add(u.user_id, "-SYSADMIN-"); continue; }
    if (u.user_id === "Admin" || /@growpath\.net$/i.test(u.email ?? "")) { add(u.user_id, "-SYSADMIN-"); if (rnd() < 0.4) add(u.user_id, "SECURITYADMINISTRATOR"); continue; }
    add(u.user_id, "EMPLOYEE");
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) add(u.user_id, biz[Math.floor(rnd() * biz.length)]);
  }
  await sql`delete from d365.sec_user_roles where mode = 'Demo'`;
  for (let i = 0; i < out.length; i += 500) await sql`insert into d365.sec_user_roles ${sql(out.slice(i, i + 500), "user_id", "role", "role_name", "status", "mode")}`;
}

async function secData() {
  await ensureSecDemo();
  const users = await sql<{ user_id: string; name: string; email: string; enabled: number; company: string }[]>`select user_id, coalesce(name,user_id) name, coalesce(email,'') email, enabled, coalesce(company_default,'') company from d365.sec_users order by user_id`;
  const roles = await sql<{ role: string; name: string; license: string }[]>`select role, coalesce(name,role) name, coalesce(license,'') license from d365.sec_roles`;
  const ur = await sql<{ user_id: string; role: string; role_name: string; status: string; mode: string }[]>`select user_id, role, coalesce(role_name, role) role_name, coalesce(status,'') status, coalesce(mode,'') mode from d365.sec_user_roles`;
  const roleName = new Map(roles.map((r) => [r.role, r.name]));
  const lic = new Map(roles.map((r) => [r.role, r.license || ROLES.find((x) => x[0] === r.role)?.[2] || ""]));
  const per = users.map((u) => {
    const mine = ur.filter((x) => x.user_id === u.user_id);
    const ls = mine.map((x) => lic.get(x.role) ?? "").filter((l) => LIC_ORDER.includes(l));
    const license = ls.sort((a, b) => LIC_ORDER.indexOf(a) - LIC_ORDER.indexOf(b))[0] ?? "None";
    const set = new Set(mine.map((x) => x.role));
    const conflicts = SOD.filter(([a, b]) => set.has(a) && set.has(b));
    return { ...u, roles: mine.map((x) => roleName.get(x.role) ?? x.role_name), role_ids: [...set], n: set.size, license, privileged: PRIV.some((p) => set.has(p)), service: isService(u), conflicts };
  });
  return { users: per, roles, ur, roleName, demo: ur.some((x) => x.mode === "Demo") };
}

const secDash: DashDef = { title: "User security", sub: "D365 users, security roles, privileged access, licences and segregation of duties", run: async (c): Promise<DashSpec> => {
  const d = await secData();
  const u = d.users, people = u.filter((x) => !x.service);
  const conf = u.flatMap((x) => x.conflicts.map((k) => ({ user: x.name, rule: k[2] })));
  return {
    tiles: [
      { label: "Users", value: u.length, fmt: "int", icon: "users", href: link(c, "/m/security", "users"), note: "All users in D365" },
      { label: "Enabled", value: u.filter((x) => x.enabled).length, fmt: "int", icon: "check", note: `${N(u.filter((x) => !x.enabled).length)} disabled` },
      { label: "Privileged users", value: u.filter((x) => x.privileged).length, fmt: "int", icon: "alert", href: link(c, "/m/security", "privileged"), note: "System / security admin" },
      { label: "Roles in use", value: new Set(d.ur.map((x) => x.role)).size, fmt: "int", icon: "tag", href: link(c, "/m/security", "roles"), note: `${N(d.roles.length)} roles defined` },
      { label: "SoD conflicts", value: conf.length, fmt: "int", icon: "ret", href: link(c, "/m/security", "sod"), note: `${N(new Set(conf.map((x) => x.user)).size)} users affected` },
      { label: "Service accounts", value: u.length - people.length, fmt: "int", icon: "doc", note: "Apps and integration users" },
    ],
    cards: [
      { title: "Users by role (top 10)", link: L(c, "/m/security", "Roles", "roles"), body: { kind: "rank", data: group(d.ur, (x) => d.roleName.get(x.role) ?? x.role_name, () => 1).slice(0, 10) } },
      { title: "Users by licence", link: L(c, "/m/security", "Licences", "licenses"), body: { kind: "donut", data: group(u, (x) => x.license, () => 1), centerLabel: "users" } },
      { title: "Users by default company", body: { kind: "donut", data: group(u, (x) => (x.company || "None").toUpperCase(), () => 1), centerLabel: "users" } },
      { title: "Privileged access", link: L(c, "/m/security", "All privileged", "privileged"), stats: [{ label: "System admins", value: N(u.filter((x) => x.role_ids.includes("-SYSADMIN-")).length), tone: "bad" }, { label: "Security admins", value: N(u.filter((x) => x.role_ids.includes("SECURITYADMINISTRATOR")).length) }, { label: "Service admins", value: N(u.filter((x) => x.service && x.privileged).length) }],
        body: { kind: "table", head: ["User", "ID", "Roles"], rows: u.filter((x) => x.privileged && !x.service).slice(0, 10).map((x) => [x.name, x.user_id, N(x.n)]) } },
      { title: "Segregation of duties", link: L(c, "/m/security", "Conflicts", "sod"), body: { kind: "bars", cols: ["Conflict", undefined, "Users"], rows: group(conf, (x) => x.rule, () => 1).map((g) => ({ a: g.label, value: g.value })) } },
      { title: "Most roles per user", link: L(c, "/m/security", "All users", "users"), body: { kind: "bars", cols: ["User", "Licence", "Roles"], rows: [...people].sort((a, b) => b.n - a.n).slice(0, 10).map((x) => ({ a: x.name, b: x.license, value: x.n })) } },
    ],
    strip: [{ label: "People", value: N(people.length) }, { label: "Users without roles", value: N(u.filter((x) => !x.n).length) }, { label: "Users with email", value: N(u.filter((x) => x.email).length) }, { label: "Avg roles per person", value: people.length ? (sum(people, (x) => x.n) / people.length).toFixed(1) : "–" }],
    note: d.demo ? "Users are read from D365 (SystemUsers). Role assignments are demo until the security role entities are readable for the integration user." : undefined,
  };
} };

const secNote = (demo: boolean) => (demo ? "Role assignments are demo: D365 restricts the security role entities for this connection. Users are real." : undefined);
const security: ModuleDef = { key: "security", title: "User security", sub: "D365 users, roles, privileged access, segregation of duties and licences", reports: [
  { key: "users", label: "Users & roles", run: async () => {
    const d = await secData();
    const rows = d.users.map((u) => ({ user_id: u.user_id, name: u.name, email: u.email, company: u.company.toUpperCase(), enabled: u.enabled ? "Yes" : "No", type: u.service ? "Service" : "Person", n: u.n, license: u.license, roles: u.roles.join(", "), sod: u.conflicts.length }));
    return { kpis: [{ label: "Users", value: N(rows.length) }, { label: "People", value: N(rows.filter((r) => r.type === "Person").length) }, { label: "Disabled", value: N(rows.filter((r) => r.enabled === "No").length) }, { label: "Without roles", value: N(rows.filter((r) => !r.n).length), tone: "warn" }],
      tables: [{ title: "Users and their roles", rows, cols: [{ key: "user_id", label: "User ID" }, { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "company", label: "Company" }, { key: "enabled", label: "Enabled" },
        { key: "type", label: "Type" }, { key: "license", label: "Licence" }, { key: "n", label: "Roles", type: "int" }, { key: "sod", label: "SoD conflicts", type: "int", tone: "badIfPositive" }, { key: "roles", label: "Role names", wrap: true }] }], note: secNote(d.demo) };
  } },
  { key: "roles", label: "Roles & members", run: async () => {
    const d = await secData();
    const rows = d.roles.map((r) => { const m = d.ur.filter((x) => x.role === r.role); const names = m.map((x) => d.users.find((u) => u.user_id === x.user_id)?.name ?? x.user_id);
      return { role: r.role, name: r.name, license: r.license, members: m.length, people: m.filter((x) => !d.users.find((u) => u.user_id === x.user_id)?.service).length, list: names.slice(0, 40).join(", ") + (names.length > 40 ? " …" : "") }; }).sort((a, b) => b.members - a.members);
    return { kpis: [{ label: "Roles", value: N(rows.length) }, { label: "In use", value: N(rows.filter((r) => r.members).length) }, { label: "Unused", value: N(rows.filter((r) => !r.members).length) }, { label: "Assignments", value: N(d.ur.length) }],
      charts: [{ title: "Members per role", kind: "rank", data: rows.filter((r) => r.members).slice(0, 12).map((r) => ({ label: r.name, value: r.members })) }],
      tables: [{ title: "Security roles", rows, cols: [{ key: "name", label: "Role" }, { key: "role", label: "Role ID" }, { key: "license", label: "Licence" }, { key: "members", label: "Users", type: "int" }, { key: "people", label: "People", type: "int" }, { key: "list", label: "Members", wrap: true }] }], note: secNote(d.demo) };
  } },
  { key: "privileged", label: "Privileged access", run: async () => {
    const d = await secData();
    const rows = d.users.filter((u) => u.privileged).map((u) => ({ user_id: u.user_id, name: u.name, email: u.email, type: u.service ? "Service" : "Person", sysadmin: u.role_ids.includes("-SYSADMIN-") ? "Yes" : "", secadmin: u.role_ids.includes("SECURITYADMINISTRATOR") ? "Yes" : "", enabled: u.enabled ? "Yes" : "No", n: u.n }));
    return { kpis: [{ label: "Privileged users", value: N(rows.length), tone: "bad" }, { label: "System admins", value: N(rows.filter((r) => r.sysadmin).length) }, { label: "Security admins", value: N(rows.filter((r) => r.secadmin).length) }, { label: "People", value: N(rows.filter((r) => r.type === "Person").length) }],
      tables: [{ title: "Users with System administrator or Security administrator", rows, cols: [{ key: "user_id", label: "User ID" }, { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "type", label: "Type" },
        { key: "sysadmin", label: "System admin" }, { key: "secadmin", label: "Security admin" }, { key: "enabled", label: "Enabled" }, { key: "n", label: "Roles", type: "int" }] }],
      note: (secNote(d.demo) ? secNote(d.demo) + " " : "") + "Review: keep System administrator to a few named people; service accounts should hold only the roles their integration needs." };
  } },
  { key: "sod", label: "Segregation of duties", run: async () => {
    const d = await secData();
    const rows = d.users.flatMap((u) => u.conflicts.map(([a, b, why]) => ({ user_id: u.user_id, name: u.name, role_a: d.roleName.get(a) ?? a, role_b: d.roleName.get(b) ?? b, why })));
    return { kpis: [{ label: "Conflicts", value: N(rows.length), tone: rows.length ? "bad" : "good" }, { label: "Users affected", value: N(new Set(rows.map((r) => r.user_id)).size) }, { label: "Rules checked", value: N(SOD.length) }],
      charts: [{ title: "Conflicts by rule", kind: "rank", data: group(rows, (r) => r.why, () => 1) }],
      tables: [{ title: "Users holding conflicting roles", rows, cols: [{ key: "user_id", label: "User ID" }, { key: "name", label: "Name" }, { key: "role_a", label: "Role" }, { key: "role_b", label: "Conflicts with" }, { key: "why", label: "Risk", wrap: true }] },
        { title: "Rules", rows: SOD.map(([a, b, why]) => ({ a: d.roleName.get(a) ?? a, b: d.roleName.get(b) ?? b, why })), cols: [{ key: "a", label: "Role" }, { key: "b", label: "With" }, { key: "why", label: "Risk", wrap: true }] }], note: secNote(d.demo) };
  } },
  { key: "licenses", label: "Licences", run: async () => {
    const d = await secData();
    const rows = d.users.map((u) => ({ user_id: u.user_id, name: u.name, type: u.service ? "Service" : "Person", license: u.license, driver: u.roles.find((r) => (d.roles.find((x) => x.name === r)?.license || ROLES.find((x) => x[1] === r)?.[2]) === u.license) ?? "", n: u.n }))
      .sort((a, b) => LIC_ORDER.indexOf(a.license) - LIC_ORDER.indexOf(b.license));
    return { kpis: LIC_ORDER.filter((l) => rows.some((r) => r.license === l)).slice(0, 6).map((l) => ({ label: l, value: N(rows.filter((r) => r.license === l).length) })),
      charts: [{ title: "Users by licence", kind: "rank", data: LIC_ORDER.map((l) => ({ label: l, value: rows.filter((r) => r.license === l).length })).filter((x) => x.value) }],
      tables: [{ title: "Licence needed per user", sub: "highest licence among the user's roles", rows, cols: [{ key: "user_id", label: "User ID" }, { key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "license", label: "Licence" }, { key: "driver", label: "Driven by role" }, { key: "n", label: "Roles", type: "int" }] }], note: secNote(d.demo) };
  } },
] };

export const EXTRA_MODULES: ModuleDef[] = [cost, security];
export const EXTRA_DASHBOARDS: Record<string, DashDef> = { cost: costDash, security: secDash };
