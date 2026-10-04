/**
 * EPIC-050 Fase 4 (T-4.3) — report terjadwal, bagian murni:
 * skema jadwal + perhitungan waktu jalan berikutnya.
 *
 * Jam jadwal memakai zona WIB (UTC+7) karena pengguna mengisi "jam 8 pagi".
 */
import { z } from "zod";

export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

export const SCHEDULE_CHANNELS = ["wa", "in_app"] as const;
export type ScheduleChannel = (typeof SCHEDULE_CHANNELS)[number];

export const SCHEDULE_CHANNEL_LABELS: Record<ScheduleChannel, string> = {
  wa: "WhatsApp",
  in_app: "Notifikasi aplikasi",
};

export const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

export const recipientSchema = z.union([
  z.object({ type: z.literal("user"), user_id: z.string().uuid() }),
  z.object({ type: z.literal("number"), number: z.string().trim().min(8).max(20) }),
]);
export type ScheduleRecipient = z.infer<typeof recipientSchema>;

export const reportScheduleSchema = z
  .object({
    report_id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    frequency: z.enum(SCHEDULE_FREQUENCIES).default("weekly"),
    hour: z.number().int().min(0).max(23).default(8),
    day_of_week: z.number().int().min(0).max(6).optional().nullable(),
    day_of_month: z.number().int().min(1).max(28).optional().nullable(),
    channel: z.enum(SCHEDULE_CHANNELS).default("wa"),
    recipients: z.array(recipientSchema).min(1).max(20),
    is_active: z.boolean().default(true),
  })
  // Field opsional yang dihilangkan bernilai undefined, jadi cek `== null`
  // agar jadwal mingguan/bulanan tanpa hari/tanggal ikut ditolak.
  .refine((s) => s.frequency !== "weekly" || s.day_of_week != null, { message: "Jadwal mingguan wajib memilih hari", path: ["day_of_week"] })
  .refine((s) => s.frequency !== "monthly" || s.day_of_month != null, { message: "Jadwal bulanan wajib memilih tanggal", path: ["day_of_month"] });
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Komponen tanggal WIB dari sebuah instant. */
function wibParts(at: Date): { y: number; m: number; d: number; hour: number; dow: number } {
  const w = new Date(at.getTime() + WIB_OFFSET_MS);
  return {
    y: w.getUTCFullYear(),
    m: w.getUTCMonth() + 1,
    d: w.getUTCDate(),
    hour: w.getUTCHours(),
    dow: w.getUTCDay(),
  };
}

/** Instant UTC untuk tanggal+jam WIB tertentu. */
function wibInstant(y: number, m: number, d: number, hour: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0) - WIB_OFFSET_MS);
}

/**
 * Waktu jalan berikutnya (UTC) setelah `from`, mengikuti jam WIB jadwal.
 * Selalu mengembalikan waktu yang benar-benar sesudah `from`.
 */
export function computeNextRun(
  schedule: Pick<ReportScheduleInput, "frequency" | "hour" | "day_of_week" | "day_of_month">,
  from: Date = new Date()
): Date {
  const p = wibParts(from);
  const hour = Math.min(23, Math.max(0, schedule.hour));

  if (schedule.frequency === "daily") {
    const todayRun = wibInstant(p.y, p.m, p.d, hour);
    if (todayRun.getTime() > from.getTime()) return todayRun;
    return new Date(todayRun.getTime() + 24 * 60 * 60 * 1000);
  }

  if (schedule.frequency === "weekly") {
    const target = ((schedule.day_of_week ?? 1) % 7 + 7) % 7;
    let delta = (target - p.dow + 7) % 7;
    let run = wibInstant(p.y, p.m, p.d + delta, hour);
    if (run.getTime() <= from.getTime()) {
      delta += 7;
      run = wibInstant(p.y, p.m, p.d + delta, hour);
    }
    return run;
  }

  const dom = Math.min(28, Math.max(1, schedule.day_of_month ?? 1));
  let run = wibInstant(p.y, p.m, dom, hour);
  if (run.getTime() <= from.getTime()) {
    const nextMonth = p.m === 12 ? 1 : p.m + 1;
    const nextYear = p.m === 12 ? p.y + 1 : p.y;
    run = wibInstant(nextYear, nextMonth, dom, hour);
  }
  return run;
}

/** Deskripsi jadwal untuk ditampilkan, mis. "Mingguan · Senin 08:00 WIB". */
export function describeSchedule(
  schedule: Pick<ReportScheduleInput, "frequency" | "hour" | "day_of_week" | "day_of_month">
): string {
  const jam = `${String(schedule.hour).padStart(2, "0")}:00 WIB`;
  if (schedule.frequency === "daily") return `Harian · ${jam}`;
  if (schedule.frequency === "weekly") return `Mingguan · ${DAY_NAMES[((schedule.day_of_week ?? 1) % 7 + 7) % 7]} ${jam}`;
  return `Bulanan · tanggal ${schedule.day_of_month ?? 1} ${jam}`;
}

/** Pesan WA untuk satu kiriman report terjadwal. */
export function buildScheduleMessage(
  reportName: string,
  summary: string,
  meta: { rowCount: number; periodLabel: string; url?: string | null }
): string {
  const lines = [
    `*${reportName}*`,
    `Periode: ${meta.periodLabel} · ${meta.rowCount} baris`,
    "",
    summary,
  ];
  if (meta.url) lines.push("", `Buka: ${meta.url}`);
  return lines.join("\n");
}
