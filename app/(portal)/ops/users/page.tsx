import { reportScope, one, today } from "@/lib/page";
import { qs } from "@/lib/filters";
import { userActivity } from "@/lib/reports/ops";
import { fmt, money } from "@/lib/format";
import { Filters, Kpi, KpiRow, PageHead, Panel, Empty } from "@/components/ui";
import { RankBars } from "@/components/charts";
import DataTable from "@/components/DataTable";

export const dynamic = "force-dynamic";
const hm = (iso: string) => iso.slice(11, 16);

export default async function Page({ searchParams }: { searchParams: Record<string, string> }) {
  const s = await reportScope(searchParams);
  if (!s) return <Empty>Your account has no company access yet.</Empty>;
  if (s.user.role === "sales") return <Empty>User activity is open to administrators and managers.</Empty>;
  // Default: all recorded activity (orders and journals span many years), not just the default sales year.
  if (!one(searchParams.from)) { s.from = "2000-01-01"; s.to = today(); }
  const { users, days } = await userActivity(s.company, s.from, s.to);
  const sel = one(searchParams.user);
  const dayRows = (sel ? days.filter((d) => d.user === sel) : days).map((d) => ({ ...d, first_t: hm(d.first), last_t: hm(d.last) }));
  const total = (k: "so_created" | "invoices" | "po" | "journals") => users.reduce((a, u) => a + u[k], 0);
  const activeDays = new Set(days.map((d) => d.day)).size;
  const avgSpan = days.length ? days.reduce((a, d) => a + d.hours, 0) / days.length : 0;

  return (
    <>
      <PageHead title="User activity" sub={<>{s.company.toUpperCase()} · who entered what in D365, how much and when</>} />
      <Filters s={s} show={{ currency: false, group: false }} />
      <KpiRow>
        <Kpi label="Active users" value={fmt(users.length)} />
        <Kpi label="Sales orders created" value={fmt(total("so_created"))} />
        <Kpi label="Sales invoices" value={fmt(total("invoices"))} note="by order responsible" />
        <Kpi label="Purchase orders" value={fmt(total("po"))} note="by orderer" />
        <Kpi label="Journals posted" value={fmt(total("journals"))} note="inventory journals" />
        <Kpi label="Avg. active span / day" value={`${avgSpan.toFixed(1)} h`} note={`${fmt(activeDays)} days with timed activity`} />
      </KpiRow>
      <section className="grid lg:grid-cols-[1fr_1.4fr] gap-4 mb-4">
        <Panel title="Transactions per user" sub="all document types">
          {users.length ? <RankBars data={users.slice(0, 12).map((u) => ({ label: u.name, value: u.so_created + u.invoices + u.po + u.journals }))} /> : <Empty>No activity in this period.</Empty>}
        </Panel>
        <Panel title="By user" sub="click a user for their daily activity">
          <DataTable exportName={`User activity ${s.company}`} maxHeight={360} rows={users}
            cols={[{ key: "name", label: "User", href: `?${qs(s)}&user={user}` }, { key: "so_created", label: "SO created", type: "int" }, { key: "invoices", label: "Invoices", type: "int" },
              { key: "inv_amount", label: "Invoiced", type: "money" }, { key: "po", label: "PO", type: "int" }, { key: "journals", label: "Journals", type: "int" },
              { key: "days", label: "Active days", type: "int" }, { key: "first", label: "First", type: "date" }, { key: "last", label: "Last", type: "date" }]}
            total={{ name: "Total", so_created: total("so_created"), invoices: total("invoices"), inv_amount: users.reduce((a, u) => a + u.inv_amount, 0), po: total("po"), journals: total("journals") }} />
        </Panel>
      </section>
      <Panel title={`Daily activity${sel ? ` · ${users.find((u) => u.user === sel)?.name ?? sel}` : ""}`} sub="first and last timed entry of the day (UTC) · sales orders created and journals posted">
        <DataTable exportName={`Daily activity ${s.company}`} rows={dayRows}
          cols={[{ key: "day", label: "Day", type: "date" }, { key: "name", label: "User" }, { key: "n", label: "Entries", type: "int" },
            { key: "first_t", label: "First entry" }, { key: "last_t", label: "Last entry" }, { key: "hours", label: "Active span (h)", type: "num" }]} />
      </Panel>
      <p className="text-[12px] text-muted mt-4 max-w-3xl">
        Active span = time between a user&apos;s first and last timed entry that day, not logged-in hours. Real session hours need the D365 user log
        (SysUserLog) exposed through a custom entity; once it is synced, logged-in hours appear here.
      </p>
    </>
  );
}
