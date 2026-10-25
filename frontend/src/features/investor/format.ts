/** Pembantu murni halaman investor: label perubahan, nama bulan, baris CSV dan seri grafik. */
import type { ReportColumn } from "@/features/gym/reports/csv";
import { convertToCSV } from "@/lib/utils/csv-export";
import { STREAMS, STREAM_LABELS, type DayRevenue, type MonthRow, type Stream } from "./api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2031-03" → "Mar 2031". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const idx = Number(m) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${year}` : month;
}

/** Perubahan relatif sebagai teks "+12,5%" / "-3,0%"; null bila tidak ada pembanding. */
export function changeLabel(change: number | null): string | null {
  if (change === null || !Number.isFinite(change)) return null;
  const pct = Math.round(change * 1000) / 10;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Rasio 0..1 sebagai persen satu desimal (0.225 → 22.5). */
export const percent = (ratio: number) => Math.round(ratio * 1000) / 10;

/** Nama berkas CSV: investor-<tabel>-<dari>-<sampai>.csv */
export const csvFilename = (table: string, from: string, to: string) => `investor-${table}-${from}-${to}.csv`;

/** Teks CSV dari baris dan kolom; header memakai label kolom. */
export function tableCsv<T>(rows: T[], columns: ReportColumn<T>[]): string {
  const records = rows.map((row) => Object.fromEntries(columns.map((c, i) => [`c${i}`, c.value(row)])));
  return convertToCSV(records, columns.map((c, i) => ({ key: `c${i}`, label: c.label })));
}

/** Satu baris grafik harian: hari, total dan tiap stream sebagai kolom. */
export type StreamPoint = { day: string; total: number } & Record<Stream, number>;

export function streamSeries(daily: DayRevenue[]): StreamPoint[] {
  return daily.map((d) => {
    const point = { day: d.day, total: d.total } as StreamPoint;
    for (const s of STREAMS) point[s] = d.streams[s] ?? 0;
    return point;
  });
}

/** Satu baris grafik harian per cabang; cabang tanpa id ("") menjadi "Tanpa cabang". */
export const NO_BRANCH = "Tanpa cabang";

export function branchSeries(daily: DayRevenue[], names: Record<string, string>): { keys: string[]; points: Record<string, number | string>[] } {
  const keys = new Set<string>();
  const points = daily.map((d) => {
    const point: Record<string, number | string> = { day: d.day };
    for (const [id, amount] of Object.entries(d.branches)) {
      const key = id ? (names[id] ?? id) : NO_BRANCH;
      keys.add(key);
      point[key] = ((point[key] as number) ?? 0) + amount;
    }
    return point;
  });
  const ordered = [...keys].sort((a, b) => a.localeCompare(b));
  for (const p of points) for (const k of ordered) p[k] ??= 0;
  return { keys: ordered, points };
}

/** Kolom tabel kinerja bulanan; nilai mentah untuk CSV, format di layar oleh pemanggil. */
export function monthColumns(money: (v: number) => string, pct: (ratio: number | null) => string): ReportColumn<MonthRow>[] {
  return [
    { label: "Bulan", value: (r) => r.month, render: (r) => monthLabel(r.month) },
    { label: "Pendapatan", value: (r) => r.revenue.total, render: (r) => money(r.revenue.total), numeric: true },
    ...STREAMS.map(
      (s): ReportColumn<MonthRow> => ({
        label: STREAM_LABELS[s],
        value: (r) => r.revenue.streams[s] ?? 0,
        render: (r) => money(r.revenue.streams[s] ?? 0),
        numeric: true,
      })
    ),
    { label: "Pendapatan (buku)", value: (r) => r.accounting?.revenue ?? null, render: (r) => (r.accounting ? money(r.accounting.revenue) : "-"), numeric: true },
    { label: "HPP", value: (r) => r.accounting?.cogs ?? null, render: (r) => (r.accounting ? money(r.accounting.cogs) : "-"), numeric: true },
    { label: "Margin kotor", value: (r) => r.accounting?.gross_margin ?? null, render: (r) => pct(r.accounting?.gross_margin ?? null), numeric: true },
    { label: "Beban operasional", value: (r) => r.accounting?.expenses ?? null, render: (r) => (r.accounting ? money(r.accounting.expenses) : "-"), numeric: true },
    { label: "Laba operasional", value: (r) => r.accounting?.operating_income ?? null, render: (r) => (r.accounting ? money(r.accounting.operating_income) : "-"), numeric: true },
    { label: "Member baru", value: (r) => r.members.new, numeric: true },
    { label: "Member aktif", value: (r) => r.members.active, numeric: true },
    { label: "Retensi", value: (r) => r.members.retention_rate, render: (r) => pct(r.members.retention_rate), numeric: true },
    { label: "Sesi kelas", value: (r) => r.classes.sessions, numeric: true },
    { label: "Check-in", value: (r) => r.classes.checked_in, numeric: true },
    { label: "Isi kelas", value: (r) => r.classes.avg_fill, render: (r) => pct(r.classes.avg_fill), numeric: true },
    { label: "Sesi PT", value: (r) => r.pt_sessions, numeric: true },
  ];
}

/** Ukuran berkas ringkas: 1.5 MB, 320 KB. */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
