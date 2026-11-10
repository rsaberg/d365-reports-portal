import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getScope, qs } from "@/lib/filters";
import { salesDashboard } from "@/lib/reports/salesdash";
import { pct } from "@/lib/reports/common";
import { fmt, dateFmt } from "@/lib/format";
import { Filters, PageHead, Empty } from "@/components/ui";
import { Donut, PctLine, RankBars, SalesOrders } from "@/components/charts";
import { BarRows, Card, P, Stat, Tile, short } from "@/components/dash";

export const dynamic = "force-dynamic";


export default async function Dashboard({ searchParams }: { searchParams: Record<string, string> }) {
  const user = await requireUser();
  if (!user.companies.length) return <Empty>Your account has no company access yet. Ask your administrator to assign one.</Empty>;
  const s = await getScope(user, searchParams);
  const d = await salesDashboard(s);
  const c = s.currency;
  const q = qs(s);
  const gp = d.k.sales - d.k.cost, gpP = d.p.sales - d.p.cost;
  const margin = d.k.sales ? gp / d.k.sales : 0, marginP = d.p.sales ? gpP / d.p.sales : 0;
  const aov = d.k.orders ? d.k.sales / d.k.orders : 0, aovP = d.p.orders ? d.p.sales / d.p.orders : 0;
  const rr = d.k.sales ? d.k.returns / d.k.sales : 0, rrP = d.p.sales ? d.p.returns / d.p.sales : 0;
  const totalSales = d.byCategory.reduce((a, r) => a + r.value, 0);
  const coll = d.byMethod.reduce((a, r) => a + r.value, 0);
  const retLine = d.monthly.map((m) => ({ m: m.m, v: m.sales ? (d.returnsMonthly.find((r) => r.m === m.m)?.returns ?? 0) / m.sales : 0 }));
  const delivTotal = d.delivery.reduce((a, r) => a + r.orders, 0);
  const company = s.companies.find((x) => x.company === s.company)?.name;

  return (
    <>
      <PageHead title="Sales Analytics Dashboard" sub={<>Sales performance, customers, products and operations · {company} · {dateFmt(s.from)} – {dateFmt(s.to)}</>} />
      <Filters s={s} />

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Tile label="Total sales" value={short(d.k.sales)} unit={c} change={pct(d.k.sales, d.p.sales)} color="#1F4FA8" icon="money" href={`/sales/performance?${q}`} />
        <Tile label="Total orders" value={fmt(d.k.orders)} change={pct(d.k.orders, d.p.orders)} color="#1B8A4C" icon="cart" href={`/sales/invoices?${q}`} />
        <Tile label="Gross profit" value={short(gp)} unit={c} change={pct(gp, gpP)} color="#C98A00" icon="profit" href={`/m/margin?${q}`} />
        <Tile label="Profit margin" value={P(margin, 2)} change={marginP ? margin - marginP : null} color="#7C3AED" icon="pie" href={`/m/margin?${q}`} />
        <Tile label="Avg order value" value={short(aov)} unit={c} change={pct(aov, aovP)} color="#0E8A9E" icon="tag" />
        <Tile label="Return rate" value={P(rr, 2)} change={d.p.sales ? rr - rrP : null} color="#E2572B" icon="ret" href={`/sales/returns?${q}`} />
      </section>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Sales over time"><SalesOrders data={d.monthly} cur={c} /></Card>
        <Card title="Sales by category">
          {d.byCategory.length ? <Donut data={d.byCategory} cur={c} center={short(totalSales)} centerLabel={`Total sales (${c})`} /> : <Empty>No sales.</Empty>}
        </Card>
        <Card title="Sales by region (top 10)">
          {d.byRegion.length ? <RankBars data={d.byRegion} cur={c} height={Math.max(170, d.byRegion.length * 34)} /> : <Empty>No sales.</Empty>}
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Top 10 products by sales" action={<Link className="text-[12px] text-accent hover:underline" href={`/sales/performance?${q}`}>All items</Link>}>
          <BarRows cur={c} cols={["Product", "Category"]} rows={d.topProducts.map((r) => ({ a: r.name, b: r.category, value: r.value }))} />
        </Card>
        <Card title="Payment terms breakdown">
          {d.byTerms.length ? <Donut data={d.byTerms} cur={c} center={short(totalSales)} centerLabel={`Total sales (${c})`} /> : <Empty>No sales.</Empty>}
          {d.byMethod.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line text-[12.5px]">
              <div className="text-muted text-[11.5px] font-semibold mb-1.5">Collections by payment method · {short(coll, s.mst)}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">{d.byMethod.map((r) => <span key={r.label}>{r.label} <b className="num">{P(coll ? r.value / coll : 0)}</b></span>)}</div>
            </div>
          )}
        </Card>
        <Card title="Shipping performance">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Delivery modes" value={fmt(d.delivery.length)} />
            <Stat label="Shipped invoices" value={fmt(delivTotal)} />
            <Stat label="Avg lines / invoice" value={d.k.orders ? (d.k.lines / d.k.orders).toFixed(1) : "–"} />
          </div>
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-muted text-[11.5px]"><th className="text-left font-semibold pb-1.5">Delivery mode</th><th className="text-right font-semibold pb-1.5">Invoices</th><th className="text-right font-semibold pb-1.5">Share</th><th className="text-right font-semibold pb-1.5">Customers</th><th className="text-right font-semibold pb-1.5">Sales</th></tr></thead>
            <tbody>{d.delivery.map((r) => (
              <tr key={r.mode} className="border-t border-line"><td className="py-1.5">{r.mode}</td><td className="num text-right">{fmt(r.orders)}</td><td className="num text-right">{P(delivTotal ? r.orders / delivTotal : 0)}</td><td className="num text-right">{fmt(r.customers)}</td><td className="num text-right">{short(r.value)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        <Card title="Sales by country & city (top 10)">
          <BarRows cur={c} cols={["Country"]} rows={d.byCountry.map((r) => ({ a: `${r.country} · ${fmt(r.customers)} customers`, value: r.value }))} />
          <div className="mt-3 pt-3 border-t border-line">
            <BarRows cur={c} cols={["City"]} rows={d.byCity.map((r) => ({ a: r.label, value: r.value }))} />
          </div>
        </Card>
        <Card title="Customer analysis" action={<Link className="text-[12px] text-accent hover:underline" href={`/m/receivables?${q}&r=balances`}>Balances</Link>}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Stat label="Active customers" value={fmt(d.cust?.total ?? 0)} />
            <Stat label="New customers" value={fmt(d.cust?.new_ ?? 0)} tone="good" />
            <Stat label="Repeat customers" value={fmt(d.cust?.repeat ?? 0)} />
            <Stat label="Repeat rate" value={P(d.cust?.total ? d.cust.repeat / d.cust.total : 0)} />
          </div>
          <div className="text-muted text-[11.5px] font-semibold mb-1">Sales by customer group</div>
          {d.byGroup.length ? <Donut data={d.byGroup} cur={c} center={fmt(d.cust?.total ?? 0)} centerLabel="customers" /> : <Empty>No sales.</Empty>}
          <div className="mt-3 pt-3 border-t border-line text-[12.5px]">
            <div className="text-muted text-[11.5px] font-semibold mb-1.5">Customers by segment</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">{d.bySegment.map((r) => <span key={r.label}>{r.label} <b className="num">{fmt(r.value)}</b></span>)}</div>
          </div>
        </Card>
        <Card title="Returns" action={<Link className="text-[12px] text-accent hover:underline" href={`/sales/returns?${q}`}>Returns report</Link>}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Return rate" value={P(rr, 2)} tone={rr > rrP ? "bad" : "good"} />
            <Stat label="Returned value" value={short(d.k.returns, c)} />
            <Stat label="Return orders" value={fmt(d.returnReasons.reduce((a, r) => a + r.orders, 0))} />
          </div>
          <div className="text-muted text-[11.5px] font-semibold mb-1">Return rate over time</div>
          <PctLine data={retLine} name="Return rate" />
          <div className="text-muted text-[11.5px] font-semibold mt-3 mb-1">Return orders by reason</div>
          {d.returnReasons.length ? <RankBars data={d.returnReasons.map((r) => ({ label: r.label, value: r.value }))} height={Math.max(110, d.returnReasons.length * 30)} /> : <Empty>No return orders.</Empty>}
        </Card>
      </div>

      <section className="card px-4 py-3 mb-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[12.5px]">
        <div><div className="text-muted">Total orders (all time)</div><div className="num font-bold text-[16px]">{fmt(d.overview.orders)}</div></div>
        <div><div className="text-muted">Total customers</div><div className="num font-bold text-[16px]">{fmt(d.overview.customers)}</div></div>
        <div><div className="text-muted">Total products</div><div className="num font-bold text-[16px]">{fmt(d.overview.products)}</div></div>
        <div><div className="text-muted">Total countries</div><div className="num font-bold text-[16px]">{fmt(d.overview.countries)}</div></div>
      </section>
      <p className="text-[12px] text-muted flex flex-wrap justify-between gap-2">
        <span>Values in {c} (collections in {s.mst}) · Source: D365 {s.company.toUpperCase()} · Data as of {dateFmt(s.to)}</span>
        <span>Gross profit and margin use demo item costs until the cost entity is synced.</span>
      </p>
    </>
  );
}
