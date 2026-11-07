import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

/** One shared connection pool. DATABASE_URL = Supabase connection string (use the pooler URL on Vercel). */
export const sql =
  globalThis.__sql ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost/portal", {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    onnotice: () => {},
    prepare: false, // required for Supabase's transaction pooler
    types: {
      // numeric -> JS number (amounts fit comfortably in a double); date -> 'YYYY-MM-DD' string (no timezone shifts).
      numeric: { to: 0, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
    } as never,
  });
if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
