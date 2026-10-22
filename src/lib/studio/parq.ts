/**
 * PAR-Q / health declaration di Member App (EPIC-067 T-067-C3). Logika murni:
 * daftar pertanyaan (bahasa Inggris, untuk member), pemetaan jawaban "ya" ke
 * jenis penanda medis, dan catatan singkat untuk coach (bahasa Indonesia).
 */

/** Naikkan bila pertanyaan berubah — isian versi lama tetap tersimpan apa adanya. */
export const PARQ_VERSION = "parq-2026-10";

/** Isian dianggap kedaluwarsa setelah 12 bulan → member diminta mengisi ulang. */
export const PARQ_VALID_MONTHS = 12;
export const PARQ_DETAILS_MAX = 500;

/** Kode jenis penanda medis di studio.member_flag_types (seed C1). */
export type ParqFlagType = "medical_condition" | "injury" | "pregnant";

export interface ParqQuestion {
  code: string;
  /** Pertanyaan untuk member (Member App berbahasa Inggris). */
  text: string;
  /** Ringkasan untuk catatan coach (Coach Portal berbahasa Indonesia). */
  short: string;
  flag: ParqFlagType;
  /** Gejala yang perlu diwaspadai saat latihan → penanda tingkat Kritis. */
  critical?: boolean;
}

/** Diadaptasi dari PAR-Q standar 7 pertanyaan + kehamilan (relevan untuk latihan Hyrox). */
export const PARQ_QUESTIONS: ParqQuestion[] = [
  { code: "heart_condition", text: "Has a doctor ever said you have a heart condition or high blood pressure?", short: "jantung/tekanan darah tinggi", flag: "medical_condition" },
  { code: "chest_pain", text: "Do you feel pain in your chest at rest, during daily activities, or when you exercise?", short: "nyeri dada", flag: "medical_condition", critical: true },
  { code: "dizziness", text: "Do you lose your balance because of dizziness, or have you lost consciousness in the last 12 months?", short: "pusing/pernah pingsan", flag: "medical_condition", critical: true },
  { code: "chronic_condition", text: "Have you been diagnosed with another chronic medical condition (e.g. diabetes, asthma)?", short: "penyakit kronis lain", flag: "medical_condition" },
  { code: "medication", text: "Are you currently taking prescribed medication for a chronic medical condition?", short: "obat rutin", flag: "medical_condition" },
  { code: "bone_joint", text: "Do you have a bone, joint, or soft-tissue (muscle, ligament, tendon) problem that could get worse with more physical activity?", short: "masalah tulang/sendi/otot", flag: "injury" },
  { code: "supervised_only", text: "Has a doctor ever said you should only do medically supervised physical activity?", short: "harus diawasi tenaga medis", flag: "medical_condition", critical: true },
  { code: "pregnancy", text: "Are you pregnant, or have you given birth in the last 6 months?", short: "hamil/baru melahirkan", flag: "pregnant" },
];

export type ParqAnswers = Record<string, boolean>;

/** Semua pertanyaan versi ini harus dijawab ya/tidak. */
export function parqAnswersComplete(answers: Record<string, unknown>): answers is ParqAnswers {
  return PARQ_QUESTIONS.every((q) => typeof answers[q.code] === "boolean");
}

export interface ParqFlagPlan {
  type: ParqFlagType;
  severity: "attention" | "critical";
  note: string;
}

/**
 * Penanda yang harus ada untuk isian ini — satu per jenis, catatan berisi
 * ringkasan jawaban "ya" + keterangan member (dipotong sesuai batas catatan).
 */
export function planParqFlags(answers: ParqAnswers, details: string | null, noteMax = 200): ParqFlagPlan[] {
  const byType = new Map<ParqFlagType, string[]>();
  const critical = new Set<ParqFlagType>();
  for (const q of PARQ_QUESTIONS) {
    if (!answers[q.code]) continue;
    byType.set(q.flag, [...(byType.get(q.flag) ?? []), q.short]);
    if (q.critical) critical.add(q.flag);
  }
  const extra = details?.trim().replace(/\s+/g, " ") ?? "";
  return [...byType.entries()].map(([type, items]) => {
    const base = `PAR-Q: ${items.join(", ")}`;
    const full = extra ? `${base}. Keterangan member: ${extra}` : base;
    return {
      type,
      severity: critical.has(type) ? "critical" : "attention",
      note: full.length > noteMax ? `${full.slice(0, noteMax - 1)}…` : full,
    };
  });
}

/** Perlu (ulang) mengisi: belum pernah, versi pertanyaan berubah, atau sudah lewat 12 bulan. */
export function parqDue(last: { submitted_at: string; version: string } | null, now: Date = new Date()): boolean {
  if (!last) return true;
  if (last.version !== PARQ_VERSION) return true;
  const expires = new Date(last.submitted_at);
  expires.setUTCMonth(expires.getUTCMonth() + PARQ_VALID_MONTHS);
  return expires.getTime() <= now.getTime();
}
