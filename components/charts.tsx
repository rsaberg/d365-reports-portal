"use client";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

/* ------------------------------------------------------------------ Dashboard charts */
export const PALETTE = ["var(--c2)", "var(--c1)", "var(--c3)", "var(--c4)", "var(--c5)", "#7C5CD6", "#2BA3B8", "#8A94A6"];

/** Donut with the total in the middle and a legend with each slice's share. */
export function Donut({ data, cur, center, centerLabel }: { data: { label: string; value: number }[]; cur?: string; center: string; centerLabel: string }) {
  const total = data.reduce((a, d) => a + Math.max(0, d.value), 0);
  const top = data.slice(0, 7);
  const rest = data.slice(7).reduce((a, d) => a + d.value, 0);
  const rows = rest > 0 ? [...top, { label: "Other", value: rest }] : top;
  return (
    <div className="grid grid-cols-[minmax(150px,190px)_1fr] items-center gap-3">
      <div className="relative h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="95%" paddingAngle={1} stroke="none" isAnimationActive={false}>
              {rows.map((d, i) => <Cell key={d.label} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<Tip cur={cur} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-content-center text-center pointer-events-none">
          <div className="num font-semibold text-[17px] leading-tight">{center}</div>
          <div className="text-[11px] text-muted">{centerLabel}</div>
        </div>
      </div>
      <ul className="grid gap-1.5 text-[12.5px] min-w-0">
        {rows.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate">{d.label}</span>
            <span className="num ml-auto ps-2 font-medium">{total ? ((d.value / total) * 100).toFixed(2) : "0.00"}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sales (area, left axis) and order count (dashed line, right axis) by month. */
export function SalesOrders({ data, cur }: { data: { m: string; sales: number; orders: number }[]; cur: string }) {
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="m" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval="preserveStartEnd" />
          <YAxis yAxisId="s" tickFormatter={short} tickLine={false} axisLine={false} width={48} />
          <YAxis yAxisId="o" orientation="right" tickFormatter={short} tickLine={false} axisLine={false} width={36} />
          <Tooltip content={<Tip labelFmt={monthLabel} />} />
          <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12 }} />
          <Area yAxisId="s" type="linear" dataKey="sales" name={`Sales (${cur})`} stroke="var(--c2)" strokeWidth={2} fill="var(--c2)" fillOpacity={0.12} dot={{ r: 3 }} isAnimationActive={false} />
          <Line yAxisId="o" type="linear" dataKey="orders" name="Invoices" stroke="var(--c1)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One series as a line with its values in percent. */
export function PctLine({ data, name }: { data: { m: string; v: number }[]; name: string }) {
  return (
    <div className="h-[170px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="m" tickFormatter={monthLabel} tickLine={false} axisLine={{ stroke: "var(--axis)" }} interval="preserveStartEnd" />
          <YAxis domain={[0, (m: number) => Math.max(m * 1.2, 0.01)]} tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v: number) => `${(v * 100).toFixed(2)}%`} labelFormatter={monthLabel} />
          <Line type="monotone" dataKey="v" name={name} stroke="var(--c5)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
