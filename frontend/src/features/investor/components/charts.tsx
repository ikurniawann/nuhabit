"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatNumber, formatRupiahCompact } from "@/lib/format";
import { STREAMS, STREAM_LABELS, type DayRevenue, type MonthRow } from "../api";
import { branchSeries, monthLabel, streamSeries } from "../format";
import { AXIS, ChartCard, SERIES, tooltipStyle } from "./shared";

const shortDay = (day: string) => formatDate(day).replace(/ \d{4}$/, "");
const money = (v: unknown) => formatRupiahCompact(Number(v));

const legend = (
  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-foreground">{value}</span>} />
);

/** Pendapatan harian ditumpuk per stream. */
export function StreamChart({ daily }: { daily: DayRevenue[] }) {
  const data = streamSeries(daily);
  const total = data.reduce((n, d) => n + d.total, 0);
  return (
    <ChartCard title="Pendapatan harian per stream" summary={`Grafik batang 90 hari, total ${formatRupiahCompact(total)}, dibagi paket kredit, pass, personal training dan toko.`}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} width={76} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => formatDate(String(d))} formatter={(v, name) => [money(v), name]} />
        {legend}
        {STREAMS.map((s, i) => (
          <Bar key={s} dataKey={s} name={STREAM_LABELS[s]} stackId="a" fill={SERIES[i]} radius={i === STREAMS.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ChartCard>
  );
}

/** Pendapatan harian ditumpuk per cabang. */
export function BranchChart({ daily, names }: { daily: DayRevenue[]; names: Record<string, string> }) {
  const { keys, points } = branchSeries(daily, names);
  return (
    <ChartCard title="Pendapatan harian per cabang" summary={`Grafik batang 90 hari per cabang: ${keys.join(", ") || "belum ada data"}.`}>
      <BarChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={1}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} width={76} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => formatDate(String(d))} formatter={(v, name) => [money(v), name]} />
        {legend}
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="a" fill={SERIES[i % SERIES.length]} radius={i === keys.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ChartCard>
  );
}

/** Pendapatan, beban operasional dan laba operasional per bulan (buku). */
export function MonthlyPnlChart({ months }: { months: MonthRow[] }) {
  const data = months.map((m) => ({
    month: m.month,
    pendapatan: m.revenue.total,
    beban: m.accounting ? m.accounting.cogs + m.accounting.expenses : 0,
    laba: m.accounting ? m.accounting.operating_income : 0,
  }));
  return (
    <ChartCard title="Pendapatan dan beban per bulan" summary={`Grafik ${months.length} bulan: pendapatan, HPP plus beban operasional, dan laba operasional dari buku.`}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} width={76} />
        <Tooltip {...tooltipStyle} labelFormatter={(m) => monthLabel(String(m))} formatter={(v, name) => [money(v), name]} />
        {legend}
        <Bar dataKey="pendapatan" name="Pendapatan" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="beban" name="HPP + beban" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
        <Bar dataKey="laba" name="Laba operasional" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartCard>
  );
}

/** Member aktif dan member baru per bulan. */
export function MemberGrowthChart({ months }: { months: MonthRow[] }) {
  const data = months.map((m) => ({ month: m.month, aktif: m.members.active, baru: m.members.new }));
  const last = months[months.length - 1];
  return (
    <ChartCard title="Pertumbuhan member" summary={`Grafik garis ${months.length} bulan; bulan terakhir ${formatNumber(last?.members.active ?? 0)} member aktif dan ${formatNumber(last?.members.new ?? 0)} member baru.`}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} labelFormatter={(m) => monthLabel(String(m))} formatter={(v, name) => [formatNumber(Number(v)), name]} />
        {legend}
        <Line type="monotone" dataKey="aktif" name="Member aktif" stroke={SERIES[0]} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="baru" name="Member baru" stroke={SERIES[2]} strokeWidth={2} dot={false} />
      </LineChart>
    </ChartCard>
  );
}
