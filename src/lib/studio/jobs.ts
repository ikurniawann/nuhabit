/**
 * Logika murni job harian & pengingat WhatsApp (EPIC-058) — tanpa DB supaya
 * mudah diuji. Waktu selalu WIB (venue).
 */

export interface JobSettings {
  /** Tutup hari otomatis: selesaikan sesi lewat + kedaluwarsakan pass. */
  auto_close_enabled: boolean;
  /** Jam WIB (0–23) mulai tutup hari; dikejar bila server mati di jam itu. */
  auto_close_hour: number;
  /** Master switch pengingat WA ke member (default mati). */
  reminders_enabled: boolean;
  /** Jam WIB kirim pengingat H-1 & info paket. */
  reminder_hour: number;
  /** Kirim "kredit hampir habis" bila sisa ≤ angka ini (dan > 0). */
  pass_low_threshold: number;
  /** Kirim "paket hampir berakhir" X hari sebelum masa berlaku habis. */
  pass_expiring_days: number;
}

export const DEFAULT_JOB_SETTINGS: JobSettings = {
  auto_close_enabled: true,
  auto_close_hour: 23,
  reminders_enabled: false,
  reminder_hour: 19,
  pass_low_threshold: 1,
  pass_expiring_days: 3,
};

/** Kunci di studio.settings (prefix job_ supaya tidak bentrok Aturan Booking). */
export const JOB_SETTING_KEYS: Record<keyof JobSettings, string> = {
  auto_close_enabled: "job_auto_close_enabled",
  auto_close_hour: "job_auto_close_hour",
  reminders_enabled: "job_reminders_enabled",
  reminder_hour: "job_reminder_hour",
  pass_low_threshold: "job_pass_low_threshold",
  pass_expiring_days: "job_pass_expiring_days",
};

/** Pesan WA hanya di jam layak (tidak menyela tidur member). */
export const QUIET_START_HOUR = 21; // ≥ 21.00 ditahan
export const QUIET_END_HOUR = 8; // < 08.00 ditahan

export function wibNow(now: Date = new Date()): { date: string; hour: number } {
  const wib = new Date(now.getTime() + 7 * 3600e3);
  return { date: wib.toISOString().slice(0, 10), hour: wib.getUTCHours() };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tutup hari perlu jalan? (sekali per tanggal, setelah jam tutup). */
export function dailyCloseDue(s: JobSettings, now: Date, lastAutoRunDate: string | null): boolean {
  if (!s.auto_close_enabled) return false;
  const { date, hour } = wibNow(now);
  return hour >= s.auto_close_hour && lastAutoRunDate !== date;
}

export function inSendWindow(now: Date): boolean {
  const { hour } = wibNow(now);
  return hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR;
}

/** Pengingat terjadwal (H-1 & info paket) jalan setelah reminder_hour, di jam layak. */
export function scheduledRemindersDue(s: JobSettings, now: Date): boolean {
  return s.reminders_enabled && inSendWindow(now) && wibNow(now).hour >= s.reminder_hour;
}

// ── Isi pesan (DESIGN.md §7: tenang, ringkas, seperti partner latihan) ─────

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Atlet";
}

/** "Sabtu, 4 Oktober" */
export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const jam = (t: string) => t.slice(0, 5).replace(":", ".");

export function sessionReminderMessage(i: { name: string | null; program: string; kind: "class" | "pt"; time: string; coach: string | null; cancelWindowHours: number }): string {
  const what = i.kind === "pt" ? `sesi Personal Training ${i.program}` : i.program;
  return [
    `Halo ${firstName(i.name)}, sesi berikutnya menunggu.`,
    `Besok ${jam(i.time)} — ${what}${i.coach ? ` bersama ${i.coach}` : ""}.`,
    `Berhalangan? Batalkan dari Member App paling lambat ${i.cancelWindowHours} jam sebelum sesi supaya kredit kembali.`,
    "Sampai jumpa di NüHabit.",
  ].join("\n");
}

export function waitlistPromotedMessage(i: { name: string | null; program: string; date: string; time: string }): string {
  return [
    `Halo ${firstName(i.name)}, ada tempat kosong untukmu.`,
    `Kamu sudah masuk kelas ${i.program}, ${longDate(i.date)} pukul ${jam(i.time)}. 1 kredit kelas sudah dikunci.`,
    "Tidak bisa datang? Batalkan dari Member App supaya tempatnya bisa dipakai teman lain.",
  ].join("\n");
}

export function passLowMessage(i: { name: string | null; product: string; left: number }): string {
  return [
    `Halo ${firstName(i.name)}, tinggal ${i.left} sesi lagi di paket ${i.product}.`,
    "Lanjutkan kebiasaanmu? Paket baru bisa dibeli langsung dari Member App.",
  ].join("\n");
}

export function passExpiringMessage(i: { name: string | null; product: string; validUntil: string; left: number }): string {
  return [
    `Halo ${firstName(i.name)}, paket ${i.product} berlaku sampai ${longDate(i.validUntil)}.`,
    `Masih ada ${i.left} sesi yang bisa kamu pakai — booking dari Member App sebelum masa berlakunya habis.`,
  ].join("\n");
}

// ── Kunci dedup (satu pesan per kejadian) ──────────────────────────────────
export const dedupKey = {
  session: (bookingId: string) => `session:${bookingId}`,
  waitlist: (bookingId: string) => `waitlist:${bookingId}`,
  passLow: (passId: string, left: number) => `pass_low:${passId}:${left}`,
  passExpiring: (passId: string) => `pass_expiring:${passId}`,
};
