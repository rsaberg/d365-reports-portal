import { reportScope } from "@/lib/page";
import { qs } from "@/lib/filters";
import { discounts } from "@/lib/reports/sales";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { RankBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const { byCustomer, variance } = await discounts(s);
  const c = s.currency;
  const gross = byCustomer.reduce((a, r) => a + Number(r.gross), 0);
  const disc = byCustomer.reduce((a, r) => a + Number(r.discount), 0);
  const lines = byCustomer.reduce((a, r) => a + r.lines, 0);
  const dl = byCustomer.reduce((a, r) => a + r.discounted_lines, 0);
  const impact = variance.reduce((a, r) => a + Number(r.impact), 0);
  const rows = byCustomer.map((r) => ({ ...r, pct: r.gross ? r.discount / r.gross : 0 }));

  return (
    <>
      <PageHead title="Discount Analysis" sub={<>Line discounts and price variance on invoiced sales · {dateFmt(s.from)} – {dateFmt(s.to)}</>} />
      <Filters s={s} />
      <KpiRow>
        <Kpi label="Gross sales" value={money(gross, c)} note="before line discounts" />
        <Kpi label="Line discounts" value={money(disc, c)} note={gross ? `${((disc / gross) * 100).toFixed(1)}% of gross` : undefined} />
        <Kpi label="Net sales" value={money(gross - disc, c)} />
        <Kpi label="Discounted lines" value={fmt(dl)} note={lines ? `${((dl / lines) * 100).toFixed(0)}% of ${fmt(lines)} lines` : undefined} />
        <Kpi label="Below-average prices" value={fmt(variance.length)} note="lines > 5% under the item's average price" tone={variance.length ? "warn" : null} />
        <Kpi label="Price variance impact" value={money(impact, c)} note="vs average price" tone={impact < 0 ? "bad" : null} />
      </KpiRow>
      <div className="grid xl:grid-cols-[1fr_1.4fr] gap-4">
        <Panel title="Discount by customer" sub={c}>
          {rows.some((r) => r.discount) ? <RankBars cur={c} data={rows.filter((r) => r.discount).slice(0, 10).map((r) => ({ label: r.name, value: Number(r.discount) }))} />
            : <Empty>No line discounts were given in this period.</Empty>}
        </Panel>
        <Panel title="Customers">
          <DataTable maxHeight={420} exportName={`Discounts by customer ${s.company} ${s.from} ${s.to}`} rows={rows}
            cols={[{ key: "customer", label: "Account", href: `/sales/performance?${qs(s)}&by=customer` }, { key: "name", label: "Customer" },
              { key: "gross", label: "Gross", type: "money" }, { key: "discount", label: "Discount", type: "money" }, { key: "pct", label: "Disc %", type: "pct" },
              { key: "net", label: "Net", type: "money" }, { key: "discounted_lines", label: "Disc. lines", type: "int" }]}
            total={{ customer: "Total", gross, discount: disc, net: gross - disc }} />
        </Panel>
      </div>
      <Panel className="mt-4" title="Lines priced more than 5% below the item's average" sub="price before line discount, compared with the item's average in the period">
        <DataTable exportName={`Price variance ${s.company} ${s.from} ${s.to}`} rows={variance}
          cols={[{ key: "invoice", label: "Invoice" }, { key: "invoice_date", label: "Date", type: "date" }, { key: "customer_name", label: "Customer" },
            { key: "item", label: "Item" }, { key: "item_name", label: "Name" }, { key: "qty", label: "Qty", type: "num" },
            { key: "price", label: "Unit price", type: "money" }, { key: "avg_price", label: "Avg price", type: "money" },
            { key: "variance", label: "Variance", type: "pct", tone: "signed" }, { key: "impact", label: `Impact (${c})`, type: "money", tone: "signed" }]}
          empty="No lines more than 5% below the average price." />
        <p className="text-[12px] text-muted mt-2">Comparing against trade agreements needs the SalesPriceAgreements entity in the sync; this view uses the period average until then.</p>
      </Panel>
    </>
  );
}
