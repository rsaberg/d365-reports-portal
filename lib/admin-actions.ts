"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requireAdmin, hashPassword } from "./auth";
import { runSync } from "./d365/sync";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveUser(f: FormData) {
  const admin = await requireAdmin();
  const id = Number(str(f, "id")) || null;
  const email = str(f, "email").toLowerCase();
  const name = str(f, "name");
  const role = str(f, "role");
  const personnel = str(f, "personnel_number") || null;
  const password = str(f, "password");
  const active = f.get("active") === "on";
  const companies = f.getAll("companies").map(String);
  const back = (msg: string) => redirect(`/admin/users?${id ? `edit=${id}&` : "new=1&"}error=${encodeURIComponent(msg)}`);

  if (!email || !name) back("Name and email are required.");
  if (!["admin", "manager", "sales"].includes(role)) back("Pick a role.");
  if (role === "sales" && !personnel) back("A sales user needs a personnel number so the portal can show their own sales.");
  if (!id && password.length < 8) back("Set a password of at least 8 characters.");
  if (id && password && password.length < 8) back("The new password must be at least 8 characters.");
  if (id === admin.id && (role !== "admin" || !active)) back("You can't remove your own admin access.");

  try {
    let uid = id;
    if (id) {
      await sql`update portal.users set email = ${email}, name = ${name}, role = ${role}, personnel_number = ${personnel}, active = ${active} where id = ${id}`;
      if (password) await sql`update portal.users set password_hash = ${await hashPassword(password)} where id = ${id}`;
    } else {
      const [u] = await sql<{ id: number }[]>`insert into portal.users (email, name, role, personnel_number, password_hash, active)
        values (${email}, ${name}, ${role}, ${personnel}, ${await hashPassword(password)}, ${active}) returning id`;
      uid = u.id;
    }
    await sql`delete from portal.user_companies where user_id = ${uid}`;
    if (companies.length) await sql`insert into portal.user_companies ${sql(companies.map((company) => ({ user_id: uid, company })))}`;
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("users_email_key") ? "Another user already has this email." : "Could not save the user.";
    back(msg);
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?saved=1");
}

export async function saveTargets(f: FormData) {
  await requireAdmin();
  const company = str(f, "company");
  const year = Number(str(f, "year"));
  const rows: { company: string; personnel_number: string; month: string; amount: number }[] = [];
  const clear: [string, string][] = [];
  for (const [k, v] of f.entries()) {
    const m = k.match(/^t\|(.+)\|(\d{2})$/);
    if (!m) continue;
    const month = `${year}-${m[2]}-01`;
    const amount = Number(String(v).replace(/,/g, ""));
    if (String(v).trim() === "" || !Number.isFinite(amount)) clear.push([m[1], month]);
    else rows.push({ company, personnel_number: m[1], month, amount });
  }
  await sql.begin(async (tx) => {
    for (const [p, month] of clear) await tx`delete from portal.targets where company = ${company} and personnel_number = ${p} and month = ${month}`;
    if (rows.length) await tx`insert into portal.targets ${tx(rows)} on conflict (company, personnel_number, month) do update set amount = excluded.amount`;
  });
  revalidatePath("/admin/targets");
  redirect(`/admin/targets?company=${company}&year=${year}&saved=1`);
}

export async function saveSettings(f: FormData) {
  await requireAdmin();
  const limits = str(f, "buckets").split(/[,\s]+/).filter(Boolean).map(Number);
  const ok = limits.length > 0 && limits.length <= 14 && limits.every((n, i) => Number.isInteger(n) && n > 0 && (i === 0 || n > limits[i - 1]));
  if (!ok) redirect(`/admin/settings?error=${encodeURIComponent("Bucket limits must be whole days, each higher than the one before (up to 14).")}`);
  const basis = str(f, "basis") === "trans" ? "trans" : "due";
  await sql`insert into portal.settings (key, value) values ('aging_buckets', ${sql.json(limits)}), ('aging_basis', ${sql.json(basis)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}

export async function syncNow(f: FormData) {
  await requireAdmin();
  const companies = f.getAll("companies").map(String);
  try {
    const res = await runSync({ companies, full: f.get("full") === "on" });
    const errors = res.filter((r) => r.error).length;
    redirect(`/admin/sync?done=${res.length - errors}&errors=${errors}`);
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    redirect(`/admin/sync?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
