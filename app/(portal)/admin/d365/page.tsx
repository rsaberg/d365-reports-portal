import { requireAdmin } from "@/lib/auth";
import D365Integration from "@/components/D365Integration";

export const dynamic = "force-dynamic";

export default async function D365Page() {
  await requireAdmin();
  return <D365Integration />;
}
