/**
 * Konstanta bersama modul Psikotes Online (EPIC-002).
 * Dipakai server (validasi/scoring) dan client (label UI).
 */

/** 20 skala PAPI Kostick + label Indonesia (utk tampilan skor & editor soal). */
export const PAPI_SCALES = {
  N: "Kebutuhan Menyelesaikan Tugas",
  G: "Peran Pekerja Keras",
  A: "Dorongan Berprestasi",
  L: "Peran Kepemimpinan",
  P: "Kebutuhan Mengatur Orang Lain",
  I: "Peran Membuat Keputusan",
  T: "Peran Sibuk",
  V: "Peran Penuh Semangat",
  X: "Kebutuhan Diperhatikan",
  S: "Peran Hubungan Sosial",
  B: "Kebutuhan Diterima Kelompok",
  O: "Kedekatan & Kasih Sayang",
  R: "Peran Teoretis",
  D: "Peran Bekerja dengan Detail",
  C: "Peran Keteraturan",
  Z: "Kebutuhan akan Perubahan",
  E: "Pengendalian Emosi",
  K: "Kebutuhan Agresi",
  F: "Dukungan terhadap Atasan",
  W: "Kebutuhan Aturan & Arahan",
} as const;

export type PapiScaleCode = keyof typeof PAPI_SCALES;

export const PAPI_SCALE_CODES = Object.keys(PAPI_SCALES) as PapiScaleCode[];

export type InstrumentKind = "mcq" | "forced_choice" | "drawing";

/** Key opsi MCQ yang diizinkan (selaras mcqOptionKeyEnum di validations). */
export const MCQ_OPTION_KEYS = ["a", "b", "c", "d", "e", "f"] as const;
export type McqOptionKey = (typeof MCQ_OPTION_KEYS)[number];

export const INSTRUMENT_KIND_LABELS: Record<InstrumentKind, string> = {
  mcq: "Pilihan Ganda",
  forced_choice: "Forced Choice",
  drawing: "Tes Gambar",
};

export const INSTRUMENT_KIND_BADGES: Record<InstrumentKind, string> = {
  mcq: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  forced_choice: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  drawing: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
};

/** Ambang badge warna skor (visual saja, bukan gate keputusan). */
export function scoreBadgeClass(score: number): string {
  if (score >= 70)
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
  if (score >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  return "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300";
}
