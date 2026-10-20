"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { formatDate, formatNumber, formatRupiahCompact } from "@/lib/format";

/**
 * Warna seri: hijau status untuk hadir, ochre untuk tidak hadir (pasangan lolos
 * cek CVD). Ochre di bawah 3:1 terhadap putih, jadi setiap grafik punya tabel
 * dengan angka yang sama di bawahnya.
 */
const SERIES = { primary: "var(--color-success)", secondary: "var(--color-ochre)" };
const AXIS = { fontSize: 11, fill: "var(--color-muted-foreground)" };

const shortDay = (day: string) => formatDate(day).replace(/ \d{4}$/, "");

/** Kartu grafik dengan judul; ringkasan dibacakan pembaca layar sebagai gambar. */
function ChartCard({ title, summary, children }: { title: string; summary: string; children: React.ReactElement }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <figure role="img" aria-label={summary} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </figure>
    </Card>
  );
}

const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "none", background: "var(--color-ink)", color: "var(--color-on-ink)", fontSize: 12 },
  labelStyle: { color: "var(--color-on-ink)" },
  itemStyle: { color: "var(--color-on-ink)" },
  cursor: { fill: "var(--color-surface-2)" },
};

export function AttendanceChart({ days }: { days: { day: string; checked_in: number; no_show: number }[] }) {
  const checkedIn = days.reduce((n, d) => n + d.checked_in, 0);
  const noShow = days.reduce((n, d) => n + d.no_show, 0);
  return (
    <ChartCard
      title="Check-in per hari"
      summary={`Grafik batang per hari: ${formatNumber(checkedIn)} check-in dan ${formatNumber(noShow)} tidak hadir di rentang ini.`}
    >
      <BarChart data={days} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => formatDate(String(d))} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => <span className="text-foreground">{value}</span>}
        />
        <Bar dataKey="checked_in" name="Check-in" stackId="a" fill={SERIES.primary} stroke="var(--color-card)" strokeWidth={2} />
        <Bar
          dataKey="no_show"
          name="Tidak hadir"
          stackId="a"
          fill={SERIES.secondary}
          stroke="var(--color-card)"
          strokeWidth={2}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartCard>
  );
}

/** Satu seri batang per hari (pendapatan, member baru). */
export function DailyBarChart({
  title,
  summary,
  data,
  dataKey,
  name,
  money = false,
}: {
  title: string;
  summary: string;
  data: { day: string }[];
  dataKey: string;
  name: string;
  money?: boolean;
}) {
  const format = (v: unknown) => (money ? formatRupiahCompact(Number(v)) : formatNumber(Number(v)));
  return (
    <ChartCard title={title} summary={summary}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: money ? 8 : -16, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={format} width={money ? 76 : 40} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => formatDate(String(d))} formatter={(v) => [format(v), name]} />
        <Bar dataKey={dataKey} name={name} fill={SERIES.primary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartCard>
  );
}
