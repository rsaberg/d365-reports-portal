import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { sql } from "./db";
import { COOKIE, readSession, signSession } from "./session";

export interface User {
  id: number; email: string; name: string; role: "admin" | "manager" | "sales";
  personnel_number: string | null; companies: string[];
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);

export async function login(email: string, password: string): Promise<string | null> {
  const [u] = await sql<{ id: number; name: string; role: User["role"]; password_hash: string; active: boolean }[]>`
    select id, name, role, password_hash, active from portal.users where lower(email) = lower(${email})`;
  if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) return "Email or password is incorrect.";
  await sql`update portal.users set last_login = now() where id = ${u.id}`;
  cookies().set(COOKIE, await signSession({ uid: u.id, role: u.role, name: u.name }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12,
  });
  return null;
}

export function logout() {
  cookies().delete(COOKIE);
}

/** Current user, reloaded from the database on every request so role/company changes apply at once. */
export async function currentUser(): Promise<User | null> {
  const s = await readSession(cookies().get(COOKIE)?.value);
  if (!s) return null;
  const [u] = await sql<(Omit<User, "companies"> & { active: boolean })[]>`
    select id, email, name, role, personnel_number, active from portal.users where id = ${s.uid}`;
  if (!u || !u.active) return null;
  const companies =
    u.role === "admin"
      ? (await sql<{ company: string }[]>`select company from d365.companies order by company`).map((r) => r.company)
      : (await sql<{ company: string }[]>`select company from portal.user_companies where user_id = ${u.id} order by company`).map((r) => r.company);
  return { id: u.id, email: u.email, name: u.name, role: u.role, personnel_number: u.personnel_number, companies };
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/");
  return u;
}
