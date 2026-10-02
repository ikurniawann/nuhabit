/**
 * Logika murni penjadwalan Studio (EPIC-052) — tanpa DB supaya mudah diuji.
 * Tanggal selalu string "YYYY-MM-DD" (zona waktu venue), jam "HH:MM".
 */

export const WEEKDAY_LABELS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"] as const;
export const WEEKDAY_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

/** Batas rentang generate sekali jalan — mencegah ribuan baris karena salah input. */
export const MAX_GENERATE_DAYS = 62;

export const COACH_LEVELS = ["coach", "head_coach"] as const;
export type CoachLevel = (typeof COACH_LEVELS)[number];
export const COACH_LEVEL_LABEL: Record<CoachLevel, string> = { coach: "Coach", head_coach: "Head Coach" };

export const PROGRAM_KINDS = ["class", "pt"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];
export const PROGRAM_KIND_LABEL: Record<ProgramKind, string> = { class: "Kelas grup", pt: "Personal Training" };

export const SESSION_STATUSES = ["scheduled", "cancelled", "completed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: "Terjadwal",
  cancelled: "Dibatalkan",
  completed: "Selesai",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** "06:30" / "06:30:00" → menit sejak tengah malam. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Normalisasi "06:30:00" → "06:30". */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** Hari ISO: 1 = Senin … 7 = Minggu. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Minggu
  return day === 0 ? 7 : day;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Senin dari minggu yang memuat `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Semua tanggal dari..sampai (inklusif). Kosong bila terbalik. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetweenInclusive(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

export interface TemplateSlot {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  program_id: string;
  coach_id: string | null;
  capacity: number;
  is_active: boolean;
}

export interface PlannedSession {
  template_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  program_id: string;
  coach_id: string | null;
  capacity: number;
}

/**
 * Ekspansi template aktif ke tanggal dalam rentang. `existing` berisi kunci
 * "templateId|tanggal" yang sudah punya sesi (dilewati — generate idempoten),
 * `skipDates` untuk hari libur yang tidak dibuka.
 */
export function expandTemplates(
  templates: TemplateSlot[],
  from: string,
  to: string,
  existing: Set<string> = new Set(),
  skipDates: Set<string> = new Set()
): PlannedSession[] {
  const active = templates.filter((t) => t.is_active);
  const out: PlannedSession[] = [];
  for (const date of eachDate(from, to)) {
    if (skipDates.has(date)) continue;
    const weekday = isoWeekday(date);
    for (const t of active) {
      if (t.weekday !== weekday) continue;
      if (existing.has(`${t.id}|${date}`)) continue;
      out.push({
        template_id: t.id,
        session_date: date,
        start_time: hhmm(t.start_time),
        end_time: hhmm(t.end_time),
        program_id: t.program_id,
        coach_id: t.coach_id,
        capacity: t.capacity,
      });
    }
  }
  return out.sort((a, b) =>
    a.session_date === b.session_date ? a.start_time.localeCompare(b.start_time) : a.session_date.localeCompare(b.session_date)
  );
}

export interface CoachSlot {
  id?: string;
  coach_id: string | null;
  session_date?: string;
  weekday?: number;
  start_time: string;
  end_time: string;
}

/**
 * Cari slot lain milik coach yang sama dan jamnya tumpang tindih. Dipakai
 * baik untuk sesi (berdasar tanggal) maupun template (berdasar hari).
 */
export function findCoachConflicts(candidate: CoachSlot, others: CoachSlot[]): CoachSlot[] {
  if (!candidate.coach_id) return [];
  return others.filter((o) => {
    if (o.coach_id !== candidate.coach_id) return false;
    if (candidate.id && o.id === candidate.id) return false;
    if (candidate.session_date !== undefined && o.session_date !== candidate.session_date) return false;
    if (candidate.weekday !== undefined && o.weekday !== candidate.weekday) return false;
    return timesOverlap(candidate.start_time, candidate.end_time, o.start_time, o.end_time);
  });
}
