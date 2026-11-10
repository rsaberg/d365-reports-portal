import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, logout } from "@/lib/auth";
import { sql } from "@/lib/db";
import Sidebar from "@/components/Sidebar";
import { One365Logo } from "@/components/Brand";
import LangToggle from "@/components/LangToggle";
import { cookies } from "next/headers";

async function signOut() {
  "use server";
  logout();
  redirect("/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [last] = await sql<{ finished_at: Date; source: string }[]>`select finished_at, source from d365.sync_runs where status = 'ok' order by finished_at desc limit 1`;
  const appName = "ONE365 Reports";
  return (
    <div className="min-h-full lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden lg:block bg-nav">
        <div className="sticky top-0 h-screen">
        <Suspense><Sidebar isAdmin={user.role === "admin"} finance={user.role !== "sales"} appName={appName} /></Suspense>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6 py-2.5 border-b border-line bg-surface">
          <details className="lg:hidden relative">
            <summary className="btn cursor-pointer list-none">Menu</summary>
            <div className="absolute z-30 mt-2 w-64 h-[70vh] rounded-lg overflow-hidden shadow-xl">
              <Suspense><Sidebar isAdmin={user.role === "admin"} finance={user.role !== "sales"} appName={appName} /></Suspense>
            </div>
          </details>
          <span className="lg:hidden"><One365Logo size={26} /></span>
          <div className="text-[12px] text-muted">
            {last ? <>Data from D365 · last refreshed {last.finished_at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" })}{last.source === "snapshot" ? " (snapshot)" : ""}</> : "No data loaded yet"}
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <span><span className="font-medium">{user.name}</span> <span className="text-muted">· {user.role}</span></span>
            <LangToggle lang={cookies().get("lang")?.value === "ar" ? "ar" : "en"} />
            <form action={signOut}><button className="btn">Sign out</button></form>
          </div>
        </header>
        <main className="px-4 lg:px-6 py-5 max-w-[1440px]">{children}</main>
      </div>
    </div>
  );
}
