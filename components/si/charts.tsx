"use client";
import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

/* Sales Intelligence charts. Every chart that represents periods or members is clickable when the row carries an
   href (drill to the next grain / the member's detail). Colours come from the portal tokens (light + dark). */

const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`;
};
const full = (n: number) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));

function Tip({ active, payload, label, cur }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-[12px] shadow-lg">
      <div className="font-medium mb-1">{payload[0]?.payload?.tip ?? label}</div>
      {payload.filter((p: any) => p.value !== null && p.value !== undefined).map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ms-auto ps-3">{cur ? `${cur} ` : ""}{full(p.value)}</span>
        </div>
      ))}
      {payload[0]?.payload?.href && <div className="text-muted mt-1">Click to drill down</div>}
    </div>
  );
}

export interface TrendRow { label: string; tip?: string; cur: number | null; prev?: number | null; cumCur?: number | null; cumTarget?: number | null; href?: string; future?: boolean }

/** Current vs comparison bars per bucket, with optional cumulative actual vs cumulative target lines (right axis). */
export function TrendChart({ data, cur, curName, prevName, cumulative }: { data: TrendRow[]; cur: string; curName: string; prevName?: string; cumulative?: boolean }) {
  const router = useRouter();
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
          onClick={(e: any) => { const h = e?.activePayload?.[0]?.payload?.href; if (h) router.push(h); }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis yAxisId="a" tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          {cumulative && <YAxis yAxisId="b" orientation="right" tickFormatter={short} tickLine={false} axisLine={false} width={48} />}
          <Tooltip content={<Tip cur={cur} />} cursor={{ fill: "rgb(var(--sunken))" }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          {prevName && <Bar yAxisId="a" dataKey="prev" name={prevName} fill="var(--cprev)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />}
          <Bar yAxisId="a" dataKey="cur" name={curName} fill="var(--c1)" radius={[3, 3, 0, 0]} maxBarSize={22} className="cursor-pointer" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.future ? "rgb(var(--line))" : "var(--c1)"} />)}
          </Bar>
          {cumulative && <Line yAxisId="b" dataKey="cumCur" name="Cumulative actual" stroke="var(--c2)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />}
          {cumulative && <Line yAxisId="b" dataKey="cumTarget" name="Cumulative target" stroke="var(--c3)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Step { label: string; value: number; total?: boolean; href?: string }
/** Bridge / waterfall: totals as full bars, deltas floating from the running total. */
export function Waterfall({ steps, cur }: { steps: Step[]; cur: string }) {
  const router = useRouter();
  let run = 0;
  const data = steps.map((s) => {
    if (s.total) { run = s.value; return { ...s, range: [Math.min(0, s.value), Math.max(0, s.value)], fill: "var(--c2)", shown: s.value }; }
    const start = run; run += s.value;
    return { ...s, range: [Math.min(start, run), Math.max(start, run)], fill: s.value >= 0 ? "rgb(var(--good))" : "rgb(var(--bad))", shown: s.value };
  });
  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}
          onClick={(e: any) => { const h = e?.activePayload?.[0]?.payload?.href; if (h) router.push(h); }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--axis)" }} tick={{ fontSize: 11 }} interval={0} />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={52} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
            <div className="card px-3 py-2 text-[12px] shadow-lg"><div className="font-medium">{payload[0].payload.label}</div><div className="num">{cur} {full(payload[0].payload.shown)}</div></div>) : null} />
          <Bar dataKey="range" radius={[3, 3, 3, 3]} maxBarSize={56} isAnimationActive={false}
            label={(p: any) => <text x={p.x + p.width / 2} y={p.y - 5} textAnchor="middle" fontSize={11} fill="rgb(var(--muted))">{(data[p.index]?.total ? "" : data[p.index]?.shown >= 0 ? "+" : "") + short(data[p.index]?.shown ?? 0)}</text>}>
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked bars with optional comparison marker and click-through. */
export function RankList({ rows, cur, max = 12 }: { rows: { label: string; value: number; prev?: number | null; sub?: string; href?: string }[]; cur?: string; max?: number }) {
  const router = useRouter();
  const top = rows.slice(0, max);
  const m = Math.max(1, ...top.map((r) => Math.abs(r.value)), ...top.map((r) => Math.abs(r.prev ?? 0)));
  return (
    <ul className="grid gap-1.5">
      {top.map((r) => (
        <li key={r.label} className={`grid grid-cols-[minmax(90px,170px)_1fr_auto] items-center gap-2 text-[12.5px] ${r.href ? "cursor-pointer hover:bg-sunken/60 rounded" : ""}`}
          onClick={() => r.href && router.push(r.href)} title={r.sub}>
          <span className="truncate">{r.label}</span>
          <span className="relative h-3.5 rounded bg-sunken overflow-hidden">
            <span className="absolute inset-y-0 start-0 rounded" style={{ width: `${(Math.max(0, r.value) / m) * 100}%`, background: "var(--c1)" }} />
            {r.prev !== undefined && r.prev !== null && <span className="absolute inset-y-[-2px] w-[2px] bg-ink/70" style={{ insetInlineStart: `${(Math.max(0, r.prev) / m) * 100}%` }} title="Comparison" />}
          </span>
          <span className="num text-end min-w-[64px]">{cur ? short(r.value) : full(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Weekday × week heat map (business days only colour; non-trading days hatched). */
export function Heatmap({ weeks, days, cur }: { weeks: { label: string; cells: { date: string; v: number | null; off: boolean; href?: string }[] }[]; days: string[]; cur: string }) {
  const router = useRouter();
  const max = Math.max(1, ...weeks.flatMap((w) => w.cells.map((c) => c.v ?? 0)));
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate border-spacing-[3px]">
        <thead><tr><th />{days.map((d) => <th key={d} className="font-medium text-muted px-1">{d}</th>)}</tr></thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.label}>
              <td className="text-muted pe-2 whitespace-nowrap">{w.label}</td>
              {w.cells.map((c) => (
                <td key={c.date} title={`${c.date} · ${c.off ? "non-trading day · " : ""}${cur} ${full(c.v ?? 0)}`}
                  onClick={() => c.href && router.push(c.href)}
                  className={`w-9 h-7 rounded ${c.href ? "cursor-pointer" : ""}`}
                  style={{ background: c.v === null ? "transparent" : c.off ? "repeating-linear-gradient(45deg, rgb(var(--sunken)), rgb(var(--sunken)) 3px, rgb(var(--line)) 3px, rgb(var(--line)) 5px)" : `color-mix(in srgb, var(--c1) ${Math.round(8 + 92 * Math.max(0, c.v) / max)}%, rgb(var(--sunken)))` }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Order-to-cash layers side by side; each layer keeps its own event date (never summed together). */
export function LayerFunnel({ steps, cur }: { steps: { label: string; value: number; note: string; href?: string }[]; cur: string }) {
  const router = useRouter();
  const m = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="grid gap-2.5">
      {steps.map((s) => (
        <div key={s.label} className={`grid gap-1 ${s.href ? "cursor-pointer" : ""}`} onClick={() => s.href && router.push(s.href)}>
          <div className="flex justify-between text-[12.5px]"><span className="font-medium">{s.label}</span><span className="num">{cur} {full(s.value)}</span></div>
          <div className="h-3 rounded bg-sunken overflow-hidden"><div className="h-full rounded" style={{ width: `${(Math.max(0, s.value) / m) * 100}%`, background: "var(--c2)" }} /></div>
          <div className="text-[11px] text-muted">{s.note}</div>
        </div>
      ))}
    </div>
  );
}

/** Pareto: bars per member + cumulative share line. */
export function Pareto({ rows, cur }: { rows: { label: string; value: number; href?: string }[]; cur: string }) {
  const router = useRouter();
  const tot = rows.reduce((a, r) => a + Math.max(0, r.value), 0) || 1;
  let acc = 0;
  const data = rows.map((r) => { acc += Math.max(0, r.value); return { ...r, cum: Math.round((acc / tot) * 1000) / 10 }; });
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} onClick={(e: any) => { const h = e?.activePayload?.[0]?.payload?.href; if (h) router.push(h); }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" hide />
          <YAxis yAxisId="a" tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="b" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={({ active, payload }: any) => active && payload?.length ? (
            <div className="card px-3 py-2 text-[12px] shadow-lg"><div className="font-medium">{payload[0].payload.label}</div>
              <div className="num">{cur} {full(payload[0].payload.value)} · cumulative {payload[0].payload.cum}%</div></div>) : null} />
          <ReferenceLine yAxisId="b" y={80} stroke="var(--axis)" strokeDasharray="4 4" />
          <Bar yAxisId="a" dataKey="value" fill="var(--c1)" maxBarSize={14} isAnimationActive={false} />
          <Line yAxisId="b" dataKey="cum" stroke="var(--c2)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
