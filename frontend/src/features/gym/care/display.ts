/** Label, warna, dan aturan tampil penanda member dan catatan coach (tanpa React). */
import type { FlagCategory, FlagColor, FlagIcon, MemberFlags, ReviewDecision, ReviewStatus } from "./api";

type BadgeVariant = "accent" | "info" | "warning" | "destructive" | "success" | "ink";

/** Warna jenis penanda ke varian Badge. Lime selalu isi lime dengan teks forest (varian accent). */
export const FLAG_BADGE: Record<FlagColor, BadgeVariant> = {
  lime: "accent",
  info: "info",
  warning: "warning",
  danger: "destructive",
  success: "success",
  ink: "ink",
};

export const FLAG_COLOR_LABEL: Record<FlagColor, string> = {
  lime: "Hijau",
  info: "Biru",
  warning: "Kuning",
  danger: "Merah",
  success: "Mint",
  ink: "Hitam",
};

export const FLAG_ICON_LABEL: Record<FlagIcon, string> = {
  flag: "Bendera",
  bandage: "Perban",
  heart: "Jantung",
  baby: "Bayi",
  clipboard: "Papan klip",
  sprout: "Tunas",
  star: "Bintang",
  message: "Pesan",
  alert: "Peringatan",
  shield: "Perisai",
};

export const CATEGORY_LABEL: Record<FlagCategory, string> = {
  general: "Umum",
  medical: "Medis",
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: "Perlu ditinjau",
  cleared: "Aman",
  restricted: "Batasi latihan",
  doctor_note: "Perlu surat dokter",
};

export const REVIEW_DECISIONS: { value: ReviewDecision; label: string; hint: string }[] = [
  { value: "cleared", label: "Aman", hint: "Member boleh berlatih seperti biasa. Penanda dihapus." },
  { value: "restricted", label: "Batasi latihan", hint: "Penanda tetap tampil dengan catatan batasannya." },
  { value: "doctor_note", label: "Perlu surat dokter", hint: "Penanda tetap tampil sampai surat dokter diterima." },
];

export const SOURCE_LABEL: Record<"staff" | "coach" | "parq", string> = {
  staff: "Staf",
  coach: "Coach",
  parq: "PAR-Q member",
};

/** Batas teks yang sama dengan server (karakter). */
export const FLAG_NOTE_MAX = 300;
export const SESSION_NOTE_MAX = 500;

/** Penanda roster per member; member tanpa data tidak ada di peta. */
export function indexByMember(rows: readonly MemberFlags[] | undefined): Map<string, MemberFlags> {
  return new Map((rows ?? []).map((r) => [r.customer_id, r]));
}

/** "2 penanda medis" untuk penanda yang detailnya tidak boleh dibaca user ini. */
export function hiddenMedicalLabel(n: number): string {
  return n === 1 ? "1 penanda medis" : `${n} penanda medis`;
}

/** Tanggal hari ini (YYYY-MM-DD) di Jakarta, hari kalender penanda berakhir. */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

/** Tanggal berakhir bawaan untuk jenis dengan masa berlaku `days` hari, dari `today`. */
export function defaultExpiry(today: string, days: number | null): string {
  if (days === null) return "";
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
