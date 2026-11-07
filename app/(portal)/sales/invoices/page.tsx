import Link from "next/link";
import { reportScope, one } from "@/lib/page";
import { qs } from "@/lib/filters";
import { invoiceRegister, invoiceLines } from "@/lib/reports/sales";
import { money, fmt, dateFmt } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { BucketBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  const rows = await invoiceRegister(s);
  const inv = one(searchParams.invoice);
  const lines = inv ? await invoiceLines(s, inv) : null;
  const c = s.currency;
  const sum = (k: "net" | "tax" | "total" | "discount", f: (r: (typeof rows)[number]) => boolean = () => true) => rows.filter(f).reduce((a, r) => a + Number(r[k]), 0);
  const credit = rows.filter((r) => r.kind === "Credit note");
  const byMonth = new Map<string, number>();
  for (const r of rows) { const m = String(r.invoice_date).slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? 0) + Number(r.net)); }
  const monthData = [...byMonth.entries()].sort().map(([m, v]) => ({ label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`, value: v, color: "var(--c1)" }));
  const sel = inv ? rows.find((r) => r.invoice === inv) : null;

  return (
    <>
      <PageHead title="Invoice Register" sub={<>Posted sales invoices and credit notes · {dateFmt(s.from)} – {dateFmt(s.to)}</>} />
      <Filters s={s} />
      <KpiRow>
        <Kpi label="Invoices" value={fmt(rows.length - credit.length)} note={`${fmt(credit.length)} credit notes`} />
        <Kpi label="Net amount" value={money(sum("net"), c)} note="excluding tax" />
        <Kpi label="Sales tax" value={money(sum("tax"), c)} />
        <Kpi label="Total incl. tax" value={money(sum("total"), c)} note="customer ledger debit" />
        <Kpi label="Credit notes" value={money(Math.abs(sum("total", (r) => r.kind === "Credit note")), c)} tone={credit.length ? "warn" : null} note={credit.length ? "credited to customers" : "none in period"} />
        <Kpi label="Discounts" value={money(sum("discount"), c)} note="line + total discount" />
      </KpiRow>

      {sel && lines && (
        <Panel className="mb-4" title={`${sel.kind} ${sel.invoice}`} sub={`${dateFmt(sel.invoice_date)} · ${sel.customer_name} · order ${sel.sales_order || "–"}`}
          action={<Link className="text-[12px] text-accent hover:underline" href={`?${qs(s)}`}>Close</Link>}>
          <DataTable maxHeight={320} exportName={`Invoice ${sel.invoice}`} rows={lines as any}
            cols={[{ key: "line_seq", label: "#", type: "int" }, { key: "item", label: "Item" }, { key: "item_name", label: "Name" }, { key: "category", label: "Category" },
              { key: "qty", label: "Qty", type: "num" }, { key: "unit", label: "Unit" }, { key: "price", label: "Unit price", type: "money" },
              { key: "discount", label: "Discount", type: "money" }, { key: "line_amount", label: "Net", type: "money" }, { key: "tax", label: "Tax", type: "money" },
              { key: "warehouse", label: "Warehouse" }]} />
        </Panel>
      )}

      <Panel title="Net invoiced by month" sub={c} className="mb-4">
        {monthData.length ? <BucketBars data={monthData} cur={c} /> : <Empty>No invoices in this period.</Empty>}
      </Panel>
      <Panel title="Register" sub="click an invoice to see its lines">
        <DataTable exportName={`Invoice register ${s.company} ${s.from} ${s.to}`} rows={rows}
          cols={[{ key: "invoice", label: "Invoice", href: `?${qs(s)}&invoice={invoice}` }, { key: "invoice_date", label: "Date", type: "date" },
            { key: "kind", label: "Type" }, { key: "customer", label: "Account" }, { key: "customer_name", label: "Customer" },
            { key: "sales_order", label: "Sales order" }, { key: "responsible_name", label: "Salesperson" }, { key: "lines", label: "Lines", type: "int" },
            { key: "net", label: `Net (${c})`, type: "money" }, { key: "tax", label: "Tax", type: "money" }, { key: "total", label: "Total", type: "money" },
            { key: "payment_terms", label: "Terms" }]}
          total={{ invoice: "Total", net: sum("net"), tax: sum("tax"), total: sum("total") }} />
      </Panel>
    </>
  );
}
