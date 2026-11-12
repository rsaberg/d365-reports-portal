import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { siScope } from "@/lib/si/scope";
import { computeKpis } from "@/lib/si/metrics";
import { dimOptions } from "@/lib/si/query";
import { ROUTES } from "@/lib/si/render";
import { loadDemo, projectFromD365, registerCatalog } from "@/lib/si/store";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { SiView } from "@/components/si/View";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function setupAction(form: FormData) {
  "use server";
  const u = await requireAdmin();
  const op = String(form.get("op") ?? "");
  if (op === "demo") await loadDemo();
  else if (op === "catalog") await registerCatalog();
  else if (op === "project") await projectFromD365(String(form.get("company") ?? ""), u.id);
  else if (op === "calendar") {
    const company = String(form.get("company") ?? "");
    const fsm = Math.min(12, Math.max(1, Number(form.get("fiscal_start_month") ?? 1)));
    const ws = Math.min(6, Math.max(0, Number(form.get("week_start") ?? 6)));
    const weekend = String(form.get("weekend") ?? "5").split(",").map(Number).filter((n) => n >= 0 && n <= 6);
    await sql`update si.company set fiscal_start_month = ${fsm}, week_start = ${ws}, weekend = ${weekend} where company = ${company}`;
    await sql`insert into si.audit ${sql({ user_id: u.id, action: "calendar.update", target: company, detail: { fsm, ws, weekend } as never })}`;
  }
  revalidatePath("/si/health");
}

export default async function Page({ params, searchParams }: { params: { slug?: string[] }; searchParams: Record<string, string> }) {
  const slug = (params.slug ?? []).join("/");
  const route = ROUTES[slug];
  if (!route) notFound();
  const s = await siScope(searchParams, { grain: route.grain });
  if (!s) return <Empty>Your account has no company access in Sales Intelligence yet.</Empty>;
  const [kpis, options] = await Promise.all([route.needsKpis === false ? Promise.resolve(new Map()) : computeKpis(s), dimOptions(s.co.company)]);
  const screen = await route.build(s, kpis);
  const d365 = slug === "health" && s.user.role === "admin" ? await sql<{ company: string; name: string | null }[]>`select company, name from d365.companies order by 1` : [];
  return (
    <>
      <SiView s={s} screen={screen} kpis={kpis} options={options} exportName={screen.title} />
      {slug === "health" && s.user.role === "admin" && (
        <section className="card p-4 mt-4 grid gap-4 max-w-4xl">
          <h2 className="font-semibold text-[14px]">Setup (administrators)</h2>
          <form action={setupAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="op" value="project" />
            <label className="grid gap-1"><span className="label">Project a synced D365 company</span>
              <select name="company" className="input">{d365.map((c) => <option key={c.company} value={c.company}>{c.company.toUpperCase()} · {c.name}</option>)}</select></label>
            <button className="btn btn-primary">Build Sales Intelligence data</button>
            <span className="text-[12px] text-muted basis-full">Reads the portal&apos;s D365 tables (invoices, orders, customer transactions, targets) into the semantic model. Missing fields stay empty and are flagged above. Run again after each D365 sync.</span>
          </form>
          <form action={setupAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="op" value="calendar" />
            <label className="grid gap-1"><span className="label">Company</span><select name="company" className="input" defaultValue={s.co.company}>{s.companies.map((c) => <option key={c.company}>{c.company}</option>)}</select></label>
            <label className="grid gap-1"><span className="label">Fiscal year starts (month)</span><input name="fiscal_start_month" type="number" min={1} max={12} defaultValue={s.co.fiscal_start_month} className="input w-24" /></label>
            <label className="grid gap-1"><span className="label">Week starts (0 = Sun … 6 = Sat)</span><input name="week_start" type="number" min={0} max={6} defaultValue={s.co.week_start} className="input w-24" /></label>
            <label className="grid gap-1"><span className="label">Weekend days</span><input name="weekend" defaultValue={(s.co.weekend ?? []).join(",")} className="input w-24" /></label>
            <button className="btn">Save calendar</button>
          </form>
          <div className="flex flex-wrap gap-2">
            <form action={setupAction}><input type="hidden" name="op" value="demo" /><button className="btn">Reload DEMO dataset (dat, dat2)</button></form>
            <form action={setupAction}><input type="hidden" name="op" value="catalog" /><button className="btn">Re-register KPI &amp; report catalog</button></form>
          </div>
        </section>
      )}
    </>
  );
}
