// Edge-safe session helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "portal_session";
export interface SessionData { uid: number; role: "admin" | "manager" | "sales"; name: string }

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

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
