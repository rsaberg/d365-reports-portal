"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SALES_REPORTS, ADMIN, FINANCE } from "@/lib/nav";

export default function Sidebar({ isAdmin, finance, appName }: { isAdmin: boolean; finance: boolean; appName: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  // Keep the company/period/currency filters when moving between reports.
  // Sales and finance use different period formats, so only the company carries across.
  const onFin = path.startsWith("/finance");
  const qFor = (fin: boolean) => {
    const keep = new URLSearchParams();
    const keys = fin === onFin ? (fin ? ["company", "from", "to", "currency", "compare", "dim", "dv"] : ["company", "from", "to", "currency", "group"]) : ["company"];
    for (const k of keys) { const v = sp.get(k); if (v && !(k === "company" && v === "all" && !fin)) keep.set(k, v); }
    return keep.toString() ? `?${keep}` : "";
  };
  const item = (href: string, title: string, withQ = true) => {
    const q = qFor(href.startsWith("/finance"));
    const active = href === "/" ? path === "/" : href === "/finance" ? path === "/finance" : path.startsWith(href);
    return (
      <Link key={href} href={href + (withQ ? q : "")} aria-current={active ? "page" : undefined}
        className={`block rounded-md px-3 py-1.5 text-[13px] ${active ? "bg-white/10 text-white font-medium" : "text-nav-ink/80 hover:bg-white/5 hover:text-white"}`}>
        {title}
      </Link>
    );
  };
  return (
    <nav className="h-full flex flex-col gap-5 p-3 bg-nav text-nav-ink overflow-y-auto">
      <div className="px-3 pt-2">
        <div className="text-[10.5px] tracking-[.08em] uppercase text-nav-ink/60 font-semibold">D365 F&amp;O</div>
        <div className="text-white font-semibold leading-tight mt-0.5">{appName}</div>
      </div>
      <div className="grid gap-0.5">{item("/", "Sales dashboard")}</div>
      <div className="grid gap-0.5">
        <div className="px-3 pb-1 text-[10.5px] tracking-[.08em] uppercase text-nav-ink/50 font-semibold">Sales reports</div>
        {SALES_REPORTS.map((r) => item(r.href, r.title))}
      </div>
      {finance && (
        <div className="grid gap-0.5">
          <div className="px-3 pb-1 text-[10.5px] tracking-[.08em] uppercase text-nav-ink/50 font-semibold">Finance</div>
          {FINANCE.map((r) => item(r.href, r.title))}
        </div>
      )}
      {isAdmin && (
        <div className="grid gap-0.5">
          <div className="px-3 pb-1 text-[10.5px] tracking-[.08em] uppercase text-nav-ink/50 font-semibold">Administration</div>
          {ADMIN.map((r) => item(r.href, r.title, false))}
        </div>
      )}
    </nav>
  );
}
