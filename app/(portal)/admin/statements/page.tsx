import { requireAdmin } from "@/lib/auth";
import { ensureGl } from "@/lib/gl/schema";
import { accounts, getStructure, isHeading, lineFor, isPL, ROLES } from "@/lib/gl/structure";
import { getSetting } from "@/lib/d365/config";
import { PageHead } from "@/components/ui";
import StructureEditor from "@/components/StructureEditor";

export const dynamic = "force-dynamic";

export default async function StatementLayout() {
  await requireAdmin();
  await ensureGl();
  const [s, accts, saved] = await Promise.all([getStructure(), accounts(), getSetting("fs_structure")]);
  const posting = accts.filter((a) => !isHeading(a.account));
  const unmapped = posting.filter((a) => !lineFor(s, a.account, isPL(s, a.account) ? "IS" : "BS")).map((a) => ({ account: a.account, name: a.name, stmt: isPL(s, a.account) ? "IS" : "BS" }));
  const headings = accts.filter((a) => isHeading(a.account)).map((a) => ({ account: a.account, name: a.name }));
  return (
    <>
      <PageHead title="Statement layout" sub={saved ? "Edited layout in use" : "Default layout built from the chart of accounts — edit and save to make it yours"} />
      <StructureEditor initial={s} unmapped={unmapped} headings={headings} roles={ROLES} accountCount={posting.length} />
    </>
  );
}
