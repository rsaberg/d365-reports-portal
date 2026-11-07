"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`;
};
const full = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function Tip({ active, payload, label, cur, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-[12px] shadow-lg">
      <div className="font-medium mb-1">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="num ml-auto pl-3">{cur ? `${cur} ` : ""}{full(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Monthly bars: current period vs same months last year. */
export function MonthlyCompare({ data, cur }: { data: { m: string; cur: number; prev: number }[]; cur: string }) {
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="m" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval="preserveStartEnd" />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip cur={cur} labelFmt={monthLabel} />} cursor={{ fill: "rgb(var(--sunken))" }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="prev" name="Same month last year" fill="var(--cprev)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="cur" name="Selected period" fill="var(--c1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars (one series). */
export function RankBars({ data, cur, height }: { data: { label: string; value: number }[]; cur?: string; height?: number }) {
  const h = height ?? Math.max(140, data.length * 34 + 20);
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <Tooltip content={<Tip cur={cur} />} cursor={{ fill: "rgb(var(--sunken))" }} />
          <Bar dataKey="value" name="Net sales" fill="var(--c1)" radius={[0, 4, 4, 0]} maxBarSize={18}
            label={{ position: "right", formatter: short, fontSize: 11, fill: "rgb(var(--muted))" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars for buckets with an explicit color per bar (e.g. aging severity). */
export function BucketBars({ data, cur }: { data: { label: string; value: number; color: string }[]; cur?: string }) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--axis)" }} tick={{ fontSize: 11 }} interval={0} />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip cur={cur} />} cursor={{ fill: "rgb(var(--sunken))" }} />
          <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={44}
            label={{ position: "top", formatter: short, fontSize: 11, fill: "rgb(var(--muted))" }}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Two series side by side per category (e.g. target vs actual). */
export function PairBars({ data, a, b, cur }: { data: Record<string, any>[]; a: { key: string; name: string }; b: { key: string; name: string }; cur?: string }) {
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--axis)" }} tick={{ fontSize: 11 }} interval={0} />
          <YAxis tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip cur={cur} />} cursor={{ fill: "rgb(var(--sunken))" }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey={a.key} name={a.name} fill="var(--cprev)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Bar dataKey={b.key} name={b.name} fill="var(--c1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
