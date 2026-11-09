import Link from "next/link";
import { accountNames, finQs, finScope, trialBalance } from "@/lib/gl/fin";
import { isHeading, headingPrefix, isPL } from "@/lib/gl/structure";
import { FinHead, NoFinance } from "@/components/FinShell";
import DataTable, { type Col } from "@/components/DataTable";
import { Tabs } from "@/components/ui";

export const dynamic = "force-dynamic";
const LEVELS = [{ key: "1", label: "Class", len: 1 }, { key: "2", label: "Section", len: 2 }, { key: "4", label: "Group", len: 4 }, { key: "acc", label: "Account", len: 99 }];

export default async function TrialBalance({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const f = await finScope(searchParams);
  if (!f) return <NoFinance />;
  const lv = LEVELS.find((l) => l.key === searchParams.level) ?? LEVELS[3];
  const [tb, names] = await Promise.all([trialBalance(f, f.fromM, f.toM), accountNames()]);
  const heads = new Map<string, string>();
  for (const [a, n] of names) if (isHeading(a)) heads.set(headingPrefix(a), n);
  const agg = new Map<string, { account: string; name: string; type: string; op: number; dr: number; cr: number; cl: number }>();
  for (const r of tb) {
    const key = lv.len >= 99 ? r.account : r.account.slice(0, lv.len);
    const a = agg.get(key) ?? { account: key, name: lv.len >= 99 ? names.get(r.account) ?? "" : heads.get(key) ?? "", type: isPL(f.s, r.account) ? "Income statement" : "Balance sheet", op: 0, dr: 0, cr: 0, cl: 0 };
    a.op += r.op; a.dr += r.dr; a.cr += r.cr; a.cl += r.cl;
    agg.set(key, a);
  }
  const rows = [...agg.values()].sort((a, b) => a.account.localeCompare(b.account));
  const total = rows.reduce((t, r) => ({ ...t, op: t.op + r.op, dr: t.dr + r.dr, cr: t.cr + r.cr, cl: t.cl + r.cl }), { account: "Total", name: "", type: "", op: 0, dr: 0, cr: 0, cl: 0 });
  const cols: Col[] = [
    { key: "account", label: lv.len >= 99 ? "Account" : lv.label, ...(lv.len >= 99 ? { href: `/finance/account?a={account}&${finQs(f)}` } : {}) },
    { key: "name", label: "Name", wrap: true }, { key: "type", label: "Statement" },
    { key: "op", label: "Opening", type: "money" }, { key: "dr", label: "Debit", type: "money" }, { key: "cr", label: "Credit", type: "money" }, { key: "cl", label: "Closing", type: "money" },
  ];
  return (
    <>
      <FinHead f={f} title="Trial balance" show={{ compare: false }} />
      <Tabs active={lv.key} items={LEVELS.map((l) => ({ key: l.key, label: l.label, href: `?${finQs(f, { level: l.key })}` }))} />
      <DataTable cols={cols} rows={rows} total={total} maxHeight={640} exportName={`Trial balance ${f.company} ${f.fromM}_${f.toM}`} />
      <p className="text-[12px] text-muted mt-2">Debit positive. Opening includes the prior year-end close and the new year&apos;s opening entries; the closing balance is before this year&apos;s closing entries.
        {Math.abs(total.cl) >= 1 && <> Closing does not net to zero ({total.cl.toLocaleString("en-US", { maximumFractionDigits: 0 })}) — some lines may still be loading; see <Link className="link" href="/admin/sync">Data sync</Link>.</>}</p>
    </>
  );
}
