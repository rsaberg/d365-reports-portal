import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ensureGl } from "@/lib/gl/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Budget import (admin). Rows come in presentation sign (revenue +, costs −) and are stored debit positive. */
export async function POST(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await ensureGl();
  const b = await req.json().catch(() => ({}));
  const rows = Array.isArray(b.rows) ? (b.rows as { company: string; account: string; month: string; amount: number }[]) : [];
  const clean = rows.filter((r) => r && /^\S+$/.test(String(r.company)) && String(r.account).trim() && /^\d{4}-\d{2}$/.test(String(r.month)) && Number.isFinite(Number(r.amount)));
  if (!clean.length || clean.length !== rows.length) return NextResponse.json({ error: "Some rows are incomplete" }, { status: 400 });
  if (clean.length > 200000) return NextResponse.json({ error: "Too many rows (max 200,000)" }, { status: 400 });
  // Same company/account/month twice in the file: add them up.
  const agg = new Map<string, { company: string; account: string; month: string; amount: number }>();
  for (const r of clean) {
    const k = `${r.company.toLowerCase()}|${String(r.account).trim()}|${r.month}`;
    const a = agg.get(k);
    if (a) a.amount -= Number(r.amount); else agg.set(k, { company: r.company.toLowerCase(), account: String(r.account).trim(), month: `${r.month}-01`, amount: -Number(r.amount) });
  }
  const data = [...agg.values()];
  await sql.begin(async (tx) => {
    if (b.replace) {
      const pairs = [...new Set(data.map((r) => `${r.company}|${r.month.slice(0, 4)}`))];
      for (const p of pairs) { const [co, y] = p.split("|"); await tx`delete from gl.budget where company = ${co} and month >= ${y + "-01-01"} and month <= ${y + "-12-01"}`; }
    }
    for (let i = 0; i < data.length; i += 5000) {
      await tx`insert into gl.budget ${tx(data.slice(i, i + 5000))} on conflict (company, account, month) do update set amount = excluded.amount`;
    }
  });
  const known = new Set((await sql<{ account: string }[]>`select account from gl.accounts`).map((r) => r.account));
  return NextResponse.json({ ok: true, rows: data.length, unknownAccounts: [...new Set(data.map((r) => r.account))].filter((a) => !known.has(a)) });
}
