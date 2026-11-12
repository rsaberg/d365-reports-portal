import "server-only";
import { addDays, fiscal, growth, periodContext, safeDiv, tradingDays, type Range } from "./time";
import { arAsOf, backlogAsOf, bucketSum, cashAgg, customerAgg, dailySeries, delAgg, dniAsOf, invAgg, invBy, netByMonth, ordAgg, returnLag, targetFor, type SiFilter } from "./query";
import type { SiScope } from "./scope";
import { CATALOG } from "./catalog";

/**
 * KPI engine. One call computes every IMPLEMENTED metric of the catalog for the current scope, so dashboards, the
 * metric dictionary and the API all read the same numbers. Ratios are recomputed from their additive parts at the
 * requested grain; growth with a zero/absent base is N/A (null); snapshot KPIs are taken AS OF the period end.
 */
export type Unit = "money" | "pct" | "count" | "num" | "days" | "text" | "pts" | "index";
export interface KpiValue { id: string; v: number | string | null; unit: Unit; prev?: number | null; delta?: number | null; note?: string }

const UNIT: Record<string, Unit> = {};
for (const k of CATALOG) {
  const u = k.unit.toLowerCase();
  UNIT[k.id] = u.startsWith("percent") ? "pct" : u.startsWith("amount") ? "money" : u.startsWith("count") ? "count" : u.startsWith("days") ? "days" : u.includes("points") ? "pts" : u === "index" ? "index" : u === "rank" || u === "category" ? "text" : "num";
}

export async function computeKpis(s: SiScope): Promise<Map<string, KpiValue>> {
  const { f, pc, cal, asOf } = s;
  const cur = pc.current, cmp = pc.comparison;
  const td = (a: string, b: string) => tradingDays(a, b, cal);
  const fy = fiscal(asOf, cal);
  const ly = periodContext(pc.grain, asOf, cal, "ly", pc.basis, pc.isPartial).comparison!;
  const mPrev = periodContext("month", asOf, cal, "prev", pc.basis).comparison!;
  const qPrev = periodContext("quarter", asOf, cal, "prev", pc.basis).comparison!;
  const r12: Range = { start: addDays(asOf, -364), end: asOf };
  const spanStart = [cur.start, cmp?.start ?? cur.start, ly.start, mPrev.start, qPrev.start, r12.start, addDays(asOf, -90)].sort()[0];
  const noDims: SiFilter = { company: f.company, dims: s.pinnedRep ? { salesperson: [s.pinnedRep] } : {} };

  const [series, inv, invP, ord, ordP, del, delP, backlog, dni, ar, arStart, cash, cashP, cust, tgt, tgtFull, months, allSeries,
    byRep, byTerr, byChan, byItem, byCat, byWh, byReason, lag] = await Promise.all([
    dailySeries(f, { start: spanStart, end: cur.end > asOf ? cur.end : asOf }),
    invAgg(f, cur), cmp ? invAgg(f, cmp) : null, ordAgg(f, cur), cmp ? ordAgg(f, cmp) : null, delAgg(f, cur), cmp ? delAgg(f, cmp) : null,
    backlogAsOf(f, cur.end), dniAsOf(f, cur.end), arAsOf(f, cur.end), arAsOf(f, addDays(cur.start, -1)), cashAgg(f, cur), cmp ? cashAgg(f, cmp) : null,
    customerAgg(f, cur), targetFor(f, cur, td), targetFor(f, pc.full, td), netByMonth(f), Object.keys(f.dims).length ? dailySeries(noDims, cur) : null,
    invBy(f, "salesperson", cur, cmp, 100), invBy(f, "territory", cur, cmp, 50), invBy(f, "channel", cur, cmp, 50), invBy(f, "item", cur, cmp, 1000),
    invBy(f, "category", cur, cmp, 50), invBy(f, "warehouse", cur, cmp, 50), invBy(f, "reason", cur, null, 20), returnLag(f, cur),
  ]);
  const out = new Map<string, KpiValue>();
  const put = (id: string, v: number | string | null, prev?: number | null, note?: string) => {
    const unit = UNIT[id] ?? "num";
    const delta = typeof v === "number" && prev !== undefined && prev !== null ? (unit === "pct" ? v - prev : growth(v, prev)) : null;
    out.set(id, { id, v: typeof v === "number" && !Number.isFinite(v) ? null : v, unit, prev, delta, note });
  };
  const net = (r: Range) => bucketSum(series, r).net;

  // REV
  put("REV-001", inv.gross, invP?.gross); put("REV-002", inv.discount, invP?.discount); put("REV-003", inv.credits, invP?.credits); put("REV-004", inv.net, invP?.net);
  put("REV-005", growth(inv.net, net(ly)), null, `vs ${ly.start} – ${ly.end}`);
  put("REV-006", growth(net(periodContext("month", asOf, cal, "ly", pc.basis).current), net(mPrev)), null, `MTD vs ${mPrev.start} – ${mPrev.end}`);
  put("REV-007", growth(net(periodContext("quarter", asOf, cal, "ly", pc.basis).current), net(qPrev)), null, `QTD vs ${qPrev.start} – ${qPrev.end}`);
  put("REV-008", net({ start: fy.fyStart, end: asOf })); put("REV-009", net({ start: fy.monthStart, end: asOf })); put("REV-010", net({ start: fy.fqStart, end: asOf }));
  put("REV-011", net(r12));
  const fyTotals = new Map<number, { net: number; months: number }>();
  for (const m of months) { const y = fiscal(m.m + "-01", cal).fy; const t = fyTotals.get(y) ?? { net: 0, months: 0 }; t.net += m.net; t.months++; fyTotals.set(y, t); }
  const closed = [...fyTotals].filter(([y, t]) => t.months === 12 && y < fy.fy).sort((a, b) => a[0] - b[0]);
  const cagr = closed.length >= 2 && closed[0][1].net > 0 && closed[closed.length - 1][1].net > 0
    ? Math.pow(closed[closed.length - 1][1].net / closed[0][1].net, 1 / (closed.length - 1)) - 1 : null;
  put("REV-012", cagr, null, closed.length >= 2 ? `FY${closed[0][0]}–FY${closed[closed.length - 1][0]}, closed fiscal years only` : "Needs two closed fiscal years");
  const perDay = safeDiv(inv.net, pc.elapsedTradingDays);
  put("REV-013", perDay, cmp && invP ? safeDiv(invP.net, td(cmp.start, cmp.end)) : null);
  const runRate = perDay === null ? null : perDay * pc.totalTradingDays;
  put("REV-014", runRate, null, "Projection: average per trading day × trading days in the full period");
  put("REV-015", allSeries ? safeDiv(inv.net, bucketSum(allSeries, cur).net) : 1, null, allSeries ? "Filtered selection ÷ company total" : "No filter applied (100%)");

  // TAR
  const T = tgtFull.amount, Tp = tgt.amount;
  put("TAR-001", T, null, tgt.notComparable.length ? `Targets are per salesperson; not comparable with ${tgt.notComparable.join(", ")} filters` : "Approved version, full period");
  put("TAR-002", T ? safeDiv(inv.net, T) : null); put("TAR-003", T === null ? null : inv.net - T); put("TAR-004", T ? safeDiv(inv.net - T, Math.abs(T)) : null);
  put("TAR-005", Tp ? safeDiv(inv.net, Tp) : null, null, "Actual ÷ target pro-rated by elapsed trading days");
  const remaining = T === null ? null : Math.max(0, T - inv.net);
  put("TAR-006", remaining);
  const tdLeft = pc.totalTradingDays - pc.elapsedTradingDays;
  put("TAR-007", remaining === null ? null : tdLeft > 0 ? remaining / tdLeft : null, null, `${tdLeft} trading days left`);
  put("TAR-008", runRate, null, "Run-rate projection (not an AI forecast)");
  const fyCtx = periodContext("year", asOf, cal, "ly", "trading");
  const fyNet = net(fyCtx.current), fyTd = fyCtx.elapsedTradingDays;
  const pyFull = fyTotals.get(fy.fy - 1)?.net ?? null;
  put("TAR-011", fyTd && pyFull ? growth((fyNet / fyTd) * fyCtx.totalTradingDays, pyFull) : null, null, "FY run-rate projection vs last full FY");
  put("TAR-012", T ? safeDiv(inv.net + backlog.value, T) : null, null, "(Invoiced + open backlog) ÷ full-period target");

  // ORD
  put("ORD-001", ord.orders, ordP?.orders); put("ORD-002", ord.intake, ordP?.intake); put("ORD-003", ord.confirmed, ordP?.confirmed); put("ORD-004", ord.confirmed_value, ordP?.confirmed_value);
  put("ORD-005", backlog.value, null, `As of ${cur.end}`); put("ORD-006", backlog.qty); put("ORD-007", backlog.avgAge, null, "Value-weighted age"); put("ORD-008", backlog.overdue);
  put("ORD-009", ord.cancelled, ordP?.cancelled); put("ORD-010", safeDiv(ord.cancelled, ord.intake), ordP ? safeDiv(ordP.cancelled, ordP.intake) : null);
  put("ORD-011", safeDiv(ord.lines, ord.orders)); put("ORD-012", safeDiv(ord.intake, ord.orders), ordP ? safeDiv(ordP.intake, ordP.orders) : null);
  put("ORD-014", backlog.lines); put("ORD-015", backlog.holds, null, `${Math.round(backlog.holdValue).toLocaleString("en-US")} on hold`);

  // FUL
  put("FUL-001", del.qty, delP?.qty); put("FUL-002", del.value, delP?.value); put("FUL-003", dni.value, null, `${dni.lines} lines · as of ${cur.end}`);
  put("FUL-004", safeDiv(del.otif, del.otifLines), delP ? safeDiv(delP.otif, delP.otifLines) : null, `${del.otifLines} lines due in period`);
  put("FUL-005", safeDiv(del.ontime, del.otifLines), delP ? safeDiv(delP.ontime, delP.otifLines) : null); put("FUL-006", safeDiv(del.infull, del.otifLines), delP ? safeDiv(delP.infull, delP.otifLines) : null);
  put("FUL-007", safeDiv(del.partial, del.otifLines)); put("FUL-009", del.lead); put("FUL-011", del.late, delP?.late); put("FUL-012", safeDiv(del.slips, del.orders));

  // CUS
  put("CUS-001", cust.active, invP?.customers); put("CUS-002", cust.new); put("CUS-003", cust.returning); put("CUS-004", cust.reactivated); put("CUS-005", cust.dormant, null, "No invoice in the last 90 days");
  put("CUS-006", safeDiv(cust.repeaters, cust.active)); put("CUS-007", safeDiv(cust.invoices, cust.active)); put("CUS-008", safeDiv(inv.net, cust.active), invP ? safeDiv(invP.net, invP.customers) : null);
  put("CUS-011", cust.top10); put("CUS-012", cust.hhi === null ? null : cust.hhi * 10000, null, "0–10,000; above 2,500 = highly concentrated"); put("CUS-016", cust.days_since, null, "Average over customers active in the last year");

  // PRD / PRI
  const asp = safeDiv(inv.netDocs, inv.qty), aspP = invP ? safeDiv(invP.netDocs, invP.qty) : null;
  const items = [...byItem].sort((a, b) => b.cur - a.cur);
  const totalItems = items.reduce((a, x) => a + Math.max(0, x.cur), 0);
  put("PRD-001", inv.qty, invP?.qty); put("PRD-002", asp, aspP); put("PRD-003", items[0] ? safeDiv(items[0].cur, inv.net) : null, null, items[0] ? `Top SKU: ${items[0].label}` : undefined);
  put("PRD-004", items[0]?.label ?? null); const gpTop = [...byItem].filter((x) => x.gp !== null).sort((a, b) => (b.gp ?? 0) - (a.gp ?? 0))[0]; put("PRD-005", gpTop?.label ?? null);
  put("PRD-006", safeDiv(inv.qty, pc.elapsedDays), null, "Units per calendar day");
  const catTop = byCat[0]; put("PRD-007", catTop ? growth(catTop.cur, catTop.prev) : null, null, catTop ? `Largest category: ${catTop.label}` : undefined);
  const retTop = [...byItem].filter((x) => x.qty > 0).sort((a, b) => b.returns / Math.max(1, b.cur) - a.returns / Math.max(1, a.cur))[0];
  put("PRD-008", inv.qty ? inv.qtyReturned / inv.qty : null, null, retTop ? `Highest: ${retTop.label}` : undefined);
  const catPrevTot = byCat.reduce((a, x) => a + x.prev, 0), catCurTot = byCat.reduce((a, x) => a + x.cur, 0);
  const shift = byCat.map((x) => ({ l: x.label, d: (safeDiv(x.cur, catCurTot) ?? 0) - (safeDiv(x.prev, catPrevTot) ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  put("PRD-009", shift && cmp ? shift.d * 100 : null, null, shift ? `Largest shift: ${shift.l}` : undefined);
  let acc = 0; const abc = { A: 0, B: 0, C: 0 };
  for (const x of items) { acc += Math.max(0, x.cur); const sh = totalItems ? acc / totalItems : 1; abc[sh <= 0.8 ? "A" : sh <= 0.95 ? "B" : "C"]++; }
  put("PRD-010", `A ${abc.A} · B ${abc.B} · C ${abc.C}`, null, "A = first 80% of revenue, B = next 15%, C = last 5%");
  put("PRI-002", asp, aspP); put("PRI-003", inv.discount, invP?.discount); put("PRI-004", safeDiv(inv.discount, inv.gross), invP ? safeDiv(invP.discount, invP.gross) : null);
  put("PRI-008", growth(asp ?? 0, aspP), null, "Mix-affected: compare per SKU on Pricing"); put("PRI-011", inv.lowMargin, null, "Invoice lines with gross margin below 10%");

  // MAR
  const gp = inv.cogs === null ? null : inv.net - inv.cogs, gpP = invP && invP.cogs !== null ? invP.net - invP.cogs : null;
  const costNote = inv.cogs === null ? "BLOCKED BY SOURCE: no posted cost in this company's data" : inv.costCoverage < 0.999 ? `Cost on ${(inv.costCoverage * 100).toFixed(1)}% of lines` : undefined;
  put("MAR-001", inv.cogs, invP?.cogs ?? null, costNote); put("MAR-002", gp, gpP, costNote); put("MAR-003", gp === null ? null : safeDiv(gp, inv.net), gpP === null || !invP ? null : safeDiv(gpP, invP.net), costNote);
  put("MAR-004", gp === null ? null : safeDiv(gp, inv.qty)); put("MAR-005", inv.negMarginValue); put("MAR-007", inv.cogs === null ? null : safeDiv(inv.cogs, inv.net));
  put("MAR-009", inv.cogs === null || inv.cogsRestated === null ? null : -(inv.cogsRestated - inv.cogs), null, "Restated − posted cost, as a profit effect (DEMO ONLY)");
  const topGp = (rows: typeof byRep) => { const x = [...rows].filter((r) => r.gp !== null).sort((a, b) => (b.gp ?? 0) - (a.gp ?? 0))[0]; return x ? `${x.label}` : null; };
  put("MAR-013", topGp(await invBy(f, "customer", cur, null, 5000)), null, "Most profitable customer");
  put("MAR-014", topGp(byItem)); put("MAR-015", topGp(byRep)); put("MAR-016", topGp(byTerr));

  // TEA
  const repsActive = byRep.filter((x) => x.cur !== 0).length;
  put("TEA-001", safeDiv(inv.net, byRep.length || 1)); put("TEA-005", safeDiv(inv.net, repsActive));
  const repTargets = await Promise.all(byRep.map(async (r) => ({ r, t: (await targetFor({ company: f.company, dims: { salesperson: [r.key] } }, cur, td)).amount })));
  const onPace = repTargets.filter((x) => x.t && x.r.cur >= x.t).length, withT = repTargets.filter((x) => x.t).length;
  put("TEA-002", withT ? onPace / withT : null, null, `${onPace} of ${withT} reps at or above pro-rated target`);
  put("TEA-003", byTerr[0]?.label ?? null, null, byTerr[0] ? `${Math.round(byTerr[0].cur).toLocaleString("en-US")}` : undefined);
  put("TEA-004", byChan[0]?.label ?? null, null, byChan[0] ? `${Math.round(byChan[0].cur).toLocaleString("en-US")}` : undefined);
  const repDisc = [...byRep].filter((x) => x.gross > 0).sort((a, b) => b.discount / b.gross - a.discount / a.gross)[0];
  put("TEA-007", repDisc ? repDisc.discount / repDisc.gross : null, null, repDisc ? `Highest: ${repDisc.label}` : undefined);
  const repMar = [...byRep].filter((x) => x.gp !== null && x.cur > 0).sort((a, b) => (a.gp! / a.cur) - (b.gp! / b.cur))[0];
  put("TEA-008", repMar ? repMar.gp! / repMar.cur : null, null, repMar ? `Lowest: ${repMar.label}` : undefined);
  const terrG = [...byTerr].map((x) => ({ x, g: growth(x.cur, x.prev) })).filter((y) => y.g !== null).sort((a, b) => b.g! - a.g!)[0];
  put("TEA-010", terrG?.g ?? null, null, terrG ? `Fastest: ${terrG.x.label}` : undefined);
  put("TEA-011", byWh[0] ? safeDiv(byWh[0].cur, inv.net) : null, null, byWh[0] ? `Largest: ${byWh[0].label}` : undefined);
  const chPrev = byChan.reduce((a, x) => a + x.prev, 0), chCur = byChan.reduce((a, x) => a + x.cur, 0);
  const chShift = byChan.map((x) => ({ l: x.label, d: (safeDiv(x.cur, chCur) ?? 0) - (safeDiv(x.prev, chPrev) ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  put("TEA-012", chShift && cmp ? chShift.d * 100 : null, null, chShift ? `Largest shift: ${chShift.l}` : undefined);

  // RET
  put("RET-001", inv.returns, invP?.returns); put("RET-002", inv.allowances, invP?.allowances);
  put("RET-003", safeDiv(inv.returns, inv.netDocs), invP ? safeDiv(invP.returns, invP.netDocs) : null, "Physical returns ÷ invoiced sales (credit posting period)");
  put("RET-004", safeDiv(inv.qtyReturned, inv.qty)); put("RET-005", inv.returnDocs, invP?.returnDocs); put("RET-007", inv.returnCogs); put("RET-008", inv.creditNotes, invP?.creditNotes);
  const reasons = byReason.filter((x) => x.key !== "–" && x.key !== "Price allowance");
  const retTot = reasons.reduce((a, x) => a - x.cur, 0);
  const topReason = [...reasons].sort((a, b) => a.cur - b.cur)[0];
  put("RET-009", topReason && retTot ? -topReason.cur / retTot : null, null, topReason ? topReason.label : undefined);
  put("RET-010", retTot ? reasons.filter((x) => /damag|defect/i.test(x.key)).reduce((a, x) => a - x.cur, 0) / retTot : null, null, "Damaged + defective share of physical returns");
  put("RET-012", lag);

  // AR
  put("AR-001", ar.open, null, `As of ${cur.end}${ar.ignored.length ? ` · ${ar.ignored.join(", ")} filter not applicable to AR` : ""}`);
  put("AR-002", ar.pastDue); put("AR-003", ar.current); ar.aging.forEach((v, i) => put(`AR-00${4 + i}`, v));
  put("AR-008", cash.received, cashP?.received);
  const salesInclVat = inv.net + inv.tax;
  const cei = safeDiv(arStart.open + salesInclVat - ar.open, arStart.open + salesInclVat - ar.current);
  put("AR-009", cei, null, "CEI = (opening AR + period sales incl. VAT − closing AR) ÷ (opening AR + sales − closing current AR)");
  const i90 = await invAgg(f, { start: addDays(cur.end, -89), end: cur.end });
  const s90 = i90.net + i90.tax;
  put("AR-010", s90 > 0 ? (ar.open / s90) * 90 : null, null, "Simple DSO: AR as of period end ÷ last-90-day sales incl. VAT × 90");
  put("AR-011", ar.utilization); put("AR-012", ar.exposure); put("AR-013", ar.overLimit);
  put("AR-014", safeDiv(cash.ontime, cash.settlements), cashP ? safeDiv(cashP.ontime, cashP.settlements) : null, "Settlements on or before due date");

  put("INV-001", backlog.qty, null, "Open order quantity as of period end");
  return out;
}
