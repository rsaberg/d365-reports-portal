// Edge-safe session helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "portal_session";
export interface SessionData { uid: number; role: "admin" | "manager" | "sales"; name: string }

// SESSION_SECRET, or a server-only secret synced by the Supabase <-> Vercel integration.
// Set SESSION_SECRET explicitly to rotate sessions independently of Supabase keys.
const key = () =>
  new TextEncoder().encode(
    process.env.SESSION_SECRET || process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_SECRET_KEY || "",
  );

export async function signSession(data: SessionData) {
  return new SignJWT({ ...data }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(key());
}
export async function readSession(token?: string): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}
