import "server-only";
import { requireUser } from "./auth";
import { getScope } from "./filters";

/** Resolve the signed-in user and report scope; returns null when the user has no company access. */
export async function reportScope(searchParams: Record<string, string | string[] | undefined>) {
  const user = await requireUser();
  if (!user.companies.length) return null;
  return getScope(user, searchParams);
}
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
export const today = () => new Date().toISOString().slice(0, 10);
