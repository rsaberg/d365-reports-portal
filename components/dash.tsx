import Link from "next/link";
import { fmt } from "@/lib/format";
import { Empty } from "@/components/ui";
import { BucketBars, Donut, PairBars, PctLine, RankBars, Trend } from "@/components/charts";
import type { Body, CardSpec, DashSpec, Fmt, TileSpec } from "@/lib/reports/dashtypes";

/* Dashboard building blocks shared by the sales dashboard and every module dashboard. */

export const short = (n: number, c?: string) => {
  const a = Math.abs(n);
  const v = a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
  return c ? `${c} ${v}` : v;
};
export const P = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`);
export const TILE_COLORS = ["#1F4FA8", "#1B8A4C", "#C98A00", "#7C3AED", "#0E8A9E", "#E2572B"];

const ICONS: Record<string, React.ReactNode> = {
  money: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1.1 2-2.6 2-1.2 0-2.1-.5-2.6-1.3M12 6.5V8m0 8v1.5" /></>,
  cart: <><path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  profit: <><path d="M4 20V14M9 20V10M14 20V12M19 20V6" /><path d="M4 10l5-4 4 3 6-5" /></>,
  pie: <><path d="M12 3v9h9a9 9 0 1 1-9-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>,
  ret: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  box: <><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  truck: <><path d="M2 6h11v10H2zM13 10h4l3 3v3h-7" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v4m0 3v.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3 3 0 0 1 0 6M18 14c2 .8 3 2.8 3 6" /></>,
  bank: <><path d="M3 9l9-5 9 5zM5 9v8m4.7-8v8m4.6-8v8M19 9v8M3 20h18" /></>,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  factory: <><path d="M3 21V10l5 3V10l5 3V10l5 3V5h3v16z" /></>,
};

export function Tile({ label, value, unit, change, color, icon, href, vs = "vs previous year", note }: { label: string; value: string; unit?: string; change: number | null; color: string; icon: string; href?: string; vs?: string; note?: string }) {
  const up = (change ?? 0) >= 0;
  const body = (
    <div className="rounded-xl px-4 py-3.5 text-white h-full relative overflow-hidden shadow-sm" style={{ background: color }}>
      <div className="text-[11.5px] font-semibold tracking-[.06em] uppercase opacity-90 pe-10">{label}</div>
      <div className="num text-[22px] font-bold leading-tight mt-1.5 pe-11 whitespace-nowrap">{unit && <span className="text-[13px] font-semibold opacity-85 me-1">{unit}</span>}{value}</div>
      <div className="text-[12px] mt-1 opacity-95">
        {change === null ? (note ?? "No data last year") : <><span className="font-semibold">{up ? "▲" : "▼"} {P(Math.abs(change))}</span> <span className="opacity-80">{vs}</span></>}
      </div>
      <svg viewBox="0 0 24 24" width="36" height="36" className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
    </div>
  );
  return href ? <Link href={href} className="block hover:brightness-105 transition">{body}</Link> : body;
}

export function Card({ title, children, action, className = "" }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={`card p-4 min-w-0 ${className}`}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-bold text-[13px] tracking-[.05em] uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-sunken/40 px-2 py-2 text-center min-w-0">
      <div className="text-[11px] text-muted truncate" title={label}>{label}</div>
      <div className={`num font-bold text-[16px] mt-0.5 ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
    </div>
  );
}
/** Table rows with an inline proportional bar. */
export function BarRows({ rows, cols, cur }: { rows: { a: string; b?: string; value: number }[]; cols: [string, string?, string?]; cur?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <Empty>No data for this period.</Empty>;
  return (
    <table className="w-full text-[12.5px] table-fixed">
      <thead><tr className="text-muted text-[11.5px]"><th className="text-left font-semibold pb-1.5">{cols[0]}</th>{cols[1] && <th className="text-left font-semibold pb-1.5 w-[28%]">{cols[1]}</th>}<th className="text-right font-semibold pb-1.5 w-[42%]">{cols[2] ?? (cur ? `Sales (${cur})` : "Value")}</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.a + (r.b ?? "") + i}>
            <td className="py-1 pe-2 truncate" title={r.a}>{r.a}</td>
            {cols[1] && <td className="py-1 pe-2 text-muted truncate" title={r.b}>{r.b}</td>}
            <td className="py-1">
              <div className="flex items-center gap-2">
                <div className="h-2.5 rounded-sm flex-1 bg-sunken overflow-hidden"><div className="h-full rounded-sm" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: "var(--c2)" }} /></div>
                <span className="num w-[58px] text-right">{short(r.value)}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const show = (v: number, f: Fmt) => (f === "money" ? short(v) : f === "int" ? fmt(Math.round(v)) : f === "pct" ? P(v, 2) : f === "days" ? `${v.toFixed(0)} d` : v.toFixed(1));
const change = (t: TileSpec) => {
  if (t.prev === undefined || t.prev === null) return null;
  if (t.fmt === "pct") return t.value - t.prev;
  return t.prev ? (t.value - t.prev) / Math.abs(t.prev) : null;
};

function BodyView({ b, cur }: { b: Body; cur: string }) {
  const c = (m?: boolean) => (m ? cur : undefined);
  switch (b.kind) {
    case "trend": return b.data.length ? <Trend data={b.data} a={b.a} b={b.b} cur={c(b.money)} /> : <Empty>No data for this period.</Empty>;
    case "donut": {
      const data = b.data.filter((d) => d.value > 0);
      const total = data.reduce((a, d) => a + d.value, 0);
      return data.length ? <Donut data={data} cur={c(b.money)} center={b.center ?? (b.money ? short(total) : fmt(Math.round(total)))} centerLabel={b.centerLabel} /> : <Empty>No data for this period.</Empty>;
    }
    case "rank": return b.data.length ? <RankBars data={b.data} cur={c(b.money)} height={Math.max(150, b.data.length * 32)} /> : <Empty>No data for this period.</Empty>;
    case "bucket": return b.data.some((d) => d.value) ? <BucketBars data={b.data} cur={c(b.money)} /> : <Empty>No data for this period.</Empty>;
    case "pair": return b.data.length ? <PairBars data={b.data} a={b.a} b={b.b} cur={c(b.money)} /> : <Empty>No data for this period.</Empty>;
    case "bars": return <BarRows rows={b.rows} cols={b.cols} />;
    case "pctline": return <PctLine data={b.data} name={b.name} />;
    case "chips": return <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">{b.items.map((i) => <span key={i.label}>{i.label} <b className="num">{i.value}</b></span>)}</div>;
    case "table":
      if (!b.rows.length) return <Empty>Nothing to show.</Empty>;
      return (
        <div className="overflow-auto max-h-[300px]">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-muted text-[11.5px]">{b.head.map((h, i) => <th key={h} className={`font-semibold pb-1.5 whitespace-nowrap ${i ? "text-right ps-2" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => (
              <tr key={j} className="border-t border-line">{r.map((v, i) => <td key={i} className={`py-1.5 ${i ? "text-right ps-2 num whitespace-nowrap" : "truncate max-w-[150px]"}`} title={String(v)}>{typeof v === "number" ? short(v) : v}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
  }
}

export function CardView({ card, cur }: { card: CardSpec; cur: string }) {
  return (
    <Card title={card.title} className={card.wide ? "xl:col-span-2" : ""} action={card.link && <Link className="text-[12px] text-accent hover:underline" href={card.link.href}>{card.link.label}</Link>}>
      {card.stats && card.stats.length > 0 && (
        <div className={`grid gap-2 mb-3 ${card.stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : card.stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {card.stats.map((s) => <Stat key={s.label} {...s} />)}
        </div>
      )}
      {card.body && <BodyView b={card.body} cur={cur} />}
      {card.more?.map((m) => (
        <div key={m.label} className="mt-3 pt-3 border-t border-line">
          <div className="text-muted text-[11.5px] font-semibold mb-1.5">{m.label}</div>
          <BodyView b={m.body} cur={cur} />
        </div>
      ))}
    </Card>
  );
}

/** A full module dashboard: six colored tiles, then cards three to a row, then an overview strip. */
export function DashView({ spec, cur, asOf }: { spec: DashSpec; cur: string; asOf?: string }) {
  return (
    <>
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        {spec.tiles.map((t, i) => (
          <Tile key={t.label} label={t.label} value={show(t.value, t.fmt)} unit={t.fmt === "money" ? cur : undefined} change={change(t)} color={TILE_COLORS[i % TILE_COLORS.length]} icon={t.icon} href={t.href} note={t.prev === undefined ? (t.note ?? (asOf ? `As of ${asOf}` : "Current position")) : undefined} />
        ))}
      </section>
      <div className="grid xl:grid-cols-3 gap-4 mb-4">
        {spec.cards.map((c) => <CardView key={c.title} card={c} cur={cur} />)}
      </div>
      {spec.strip && (
        <section className="card px-4 py-3 mb-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[12.5px]">
          {spec.strip.map((x) => <div key={x.label}><div className="text-muted">{x.label}</div><div className="num font-bold text-[16px]">{x.value}</div></div>)}
        </section>
      )}
      {spec.note && <p className="text-[12px] text-muted">{spec.note}</p>}
    </>
  );
}
