import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

/**
 * Connection string: DATABASE_URL, or POSTGRES_URL synced by the Supabase <-> Vercel integration (pooler URL).
 * The integration adds a non-standard `supa` query parameter that Postgres would reject, so it is dropped.
 */
function connectionString() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || "postgres://localhost/portal";
  try {
    const u = new URL(raw);
    u.searchParams.delete("supa");
    return u.toString();
  } catch {
    return raw;
  }
}

/** One shared connection pool. */
export const sql =
  globalThis.__sql ??
  postgres(connectionString(), {
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
