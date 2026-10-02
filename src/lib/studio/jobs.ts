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

// ── Isi pesan WA ke member — bahasa Inggris, seragam dengan Member App (keputusan owner 2026-10-02).
// Tone DESIGN.md §7: tenang, ringkas, seperti partner latihan. longDate (Indonesia) tetap untuk teks backoffice.

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Athlete";
}

/** "Sabtu, 4 Oktober" — untuk teks backoffice (mis. deskripsi XP). */
export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Saturday, 4 October" — untuk pesan ke member. */
export function englishDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS_EN[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]}`;
}

const time24 = (t: string) => t.slice(0, 5);
const sessions = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

export function sessionReminderMessage(i: { name: string | null; program: string; kind: "class" | "pt"; time: string; coach: string | null; cancelWindowHours: number }): string {
  const what =
    i.kind !== "pt" ? i.program : /personal training/i.test(i.program) ? `your ${i.program} session` : `your Personal Training session (${i.program})`;
  return [
    `Hi ${firstName(i.name)}, your next session awaits.`,
    `Tomorrow at ${time24(i.time)} — ${what}${i.coach ? ` with ${i.coach}` : ""}.`,
    `Can't make it? Cancel in the Member App at least ${i.cancelWindowHours} hours before so your credit is returned.`,
    "See you at NüHabit.",
  ].join("\n");
}

export function waitlistPromotedMessage(i: { name: string | null; program: string; date: string; time: string }): string {
  return [
    `Hi ${firstName(i.name)}, a spot just opened up for you.`,
    `You're now booked into ${i.program} on ${englishDate(i.date)} at ${time24(i.time)}. 1 class credit has been locked in.`,
    "Can't make it? Cancel in the Member App so someone else can take the spot.",
  ].join("\n");
}

export function passLowMessage(i: { name: string | null; product: string; left: number }): string {
  return [
    `Hi ${firstName(i.name)}, only ${sessions(i.left)} left on your ${i.product} pass.`,
    "Keep the habit going? You can buy a new pass right in the Member App.",
  ].join("\n");
}

export function passExpiringMessage(i: { name: string | null; product: string; validUntil: string; left: number }): string {
  return [
    `Hi ${firstName(i.name)}, your ${i.product} pass is valid until ${englishDate(i.validUntil)}.`,
    `You still have ${sessions(i.left)} to use — book in the Member App before it expires.`,
  ].join("\n");
}

// ── Kunci dedup (satu pesan per kejadian) ──────────────────────────────────
export const dedupKey = {
  session: (bookingId: string) => `session:${bookingId}`,
  waitlist: (bookingId: string) => `waitlist:${bookingId}`,
  passLow: (passId: string, left: number) => `pass_low:${passId}:${left}`,
  passExpiring: (passId: string) => `pass_expiring:${passId}`,
};
