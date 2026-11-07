import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { saveUser } from "@/lib/admin-actions";
import { PageHead, Panel, Pill } from "@/components/ui";
import { dateFmt } from "@/lib/format";

export const dynamic = "force-dynamic";
const ROLES = [
  { v: "admin", label: "Admin", desc: "all companies, all reports, administration" },
  { v: "manager", label: "Manager", desc: "all reports for assigned companies" },
  { v: "sales", label: "Sales", desc: "only their own sales, customers and orders in assigned companies" },
];

export default async function Users({ searchParams }: { searchParams: Record<string, string> }) {
  await requireAdmin();
  const users = await sql<{ id: number; email: string; name: string; role: string; personnel_number: string | null; active: boolean; last_login: Date | null; companies: string[] }[]>`
    select u.id, u.email, u.name, u.role, u.personnel_number, u.active, u.last_login,
           coalesce(array_agg(uc.company order by uc.company) filter (where uc.company is not null), '{}') companies
    from portal.users u left join portal.user_companies uc on uc.user_id = u.id group by u.id order by u.name`;
  const companies = await sql<{ company: string; name: string }[]>`select company, coalesce(name, upper(company)) name from d365.companies order by company`;
  const workers = await sql<{ personnel_number: string; name: string }[]>`select personnel_number, name from d365.workers order by name`;
  const editId = Number(searchParams.edit) || null;
  const editing = editId ? users.find((u) => u.id === editId) : null;
  const showForm = !!editing || searchParams.new === "1";

  return (
    <>
      <PageHead title="Users & access" sub="People who can sign in, their role, and which D365 companies they can see"
        actions={!showForm ? <Link className="btn btn-primary" href="/admin/users?new=1">Add user</Link> : undefined} />
      {searchParams.saved && <p className="text-good text-[13px] mb-3">User saved.</p>}
      {showForm && (
        <Panel title={editing ? `Edit ${editing.name}` : "New user"} className="mb-4">
          {searchParams.error && <p className="text-bad text-[13px] mb-3">{searchParams.error}</p>}
          <form action={saveUser} className="grid gap-4 max-w-3xl">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1"><label htmlFor="u-name" className="label">Full name</label><input id="u-name" name="name" required className="input" defaultValue={editing?.name} /></div>
              <div className="grid gap-1"><label htmlFor="u-email" className="label">Email</label><input id="u-email" name="email" type="email" required className="input" defaultValue={editing?.email} /></div>
              <div className="grid gap-1"><label htmlFor="u-pass" className="label">{editing ? "New password (leave empty to keep)" : "Password"}</label>
                <input id="u-pass" name="password" type="password" minLength={8} required={!editing} autoComplete="new-password" className="input" /></div>
              <div className="grid gap-1"><label htmlFor="u-pn" className="label">D365 worker (needed for Sales role)</label>
                <select id="u-pn" name="personnel_number" className="input" defaultValue={editing?.personnel_number ?? ""}>
                  <option value="">None</option>
                  {workers.map((w) => <option key={w.personnel_number} value={w.personnel_number}>{w.personnel_number} · {w.name}</option>)}
                </select></div>
            </div>
            <fieldset className="grid gap-1.5">
              <legend className="label mb-1">Role</legend>
              {ROLES.map((r) => (
                <label key={r.v} className="flex items-start gap-2 text-[13px]">
                  <input type="radio" name="role" value={r.v} defaultChecked={(editing?.role ?? "manager") === r.v} className="mt-1" />
                  <span><b>{r.label}</b> <span className="text-muted">· {r.desc}</span></span>
                </label>
              ))}
            </fieldset>
            <fieldset className="grid gap-1.5">
              <legend className="label mb-1">Companies (admins see all)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {companies.map((c) => (
                  <label key={c.company} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" name="companies" value={c.company} defaultChecked={editing?.companies.includes(c.company)} />
                    {c.company.toUpperCase()} <span className="text-muted">{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} /> Active (can sign in)</label>
            <div className="flex gap-2"><button className="btn btn-primary">Save user</button><Link className="btn" href="/admin/users">Cancel</Link></div>
          </form>
        </Panel>
      )}
      <Panel title={`${users.length} users`}>
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="dtable">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Companies</th><th>Worker</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name}</td><td>{u.email}</td><td className="capitalize">{u.role}</td>
                  <td>{u.role === "admin" ? "All" : u.companies.map((c) => c.toUpperCase()).join(", ") || <span className="text-bad">None</span>}</td>
                  <td>{u.personnel_number ?? "–"}</td>
                  <td>{u.active ? <Pill tone="good">Active</Pill> : <Pill tone="neutral">Disabled</Pill>}</td>
                  <td>{u.last_login ? dateFmt(u.last_login) : "Never"}</td>
                  <td><Link className="text-accent hover:underline" href={`/admin/users?edit=${u.id}`}>Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
