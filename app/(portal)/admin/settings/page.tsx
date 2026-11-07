import { requireAdmin } from "@/lib/auth";
import { saveSettings } from "@/lib/admin-actions";
import { agingSettings, agingBuckets } from "@/lib/buckets";
import { PageHead, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Record<string, string> }) {
  await requireAdmin();
  const s = await agingSettings();
  return (
    <>
      <PageHead title="Settings" sub="Portal-wide settings. Changes apply to every user straight away." />
      {searchParams.saved && <p className="text-good text-[13px] mb-3">Settings saved.</p>}
      {searchParams.error && <p className="text-bad text-[13px] mb-3">{searchParams.error}</p>}
      <Panel title="Customer aging">
        <form action={saveSettings} className="grid gap-4 max-w-xl">
          <div className="grid gap-1">
            <label htmlFor="buckets" className="label">Bucket limits (days past due)</label>
            <input id="buckets" name="buckets" className="input num" defaultValue={s.limits.join(", ")} />
            <span className="text-[12px] text-muted">Current buckets: {agingBuckets(s.limits).map((b) => b.label).join(" · ")}</span>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="label mb-1">Default aging basis</legend>
            <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="basis" value="due" defaultChecked={s.basis === "due"} /> Due date</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="radio" name="basis" value="trans" defaultChecked={s.basis === "trans"} /> Transaction date</label>
          </fieldset>
          <div><button className="btn btn-primary">Save settings</button></div>
        </form>
      </Panel>
    </>
  );
}
