/**
 * Pemilihan konteks sesuai intent (EPIC-017 Fase C).
 *
 * Sebelumnya SELURUH objek `summary` di-JSON.stringify ke setiap prompt. Dua
 * masalah: (1) modul yang tidak ada hubungannya dengan pertanyaan ikut terkirim,
 * (2) tiap metrik terkirim DUA KALI karena `summary` memuatnya di top-level
 * (`summary.hris`) sekaligus di `summary.modules.hris.metrics` — objek yang sama.
 *
 * Fungsi di sini murni supaya bisa diuji: masuk summary + intent, keluar objek
 * ringkas yang benar-benar dikirim ke model.
 */

export type AssistantIntent =
  | "all"
  | "hris"
  | "procurement"
  | "pos"
  | "inventory"
  | "performance"
  | "payroll"
  | "integration"
  | "master";

export interface AssistantSummaryLike {
  generatedAt: string;
  modules: Record<string, { label: string; metrics: Record<string, number> }>;
  details: Partial<Record<string, Array<Record<string, unknown>>>>;
}

/**
 * Modul yang ikut dikirim per intent. Tetangga dimasukkan karena pertanyaan
 * nyata sering melintas batas modul — "stok bahan menipis" butuh inventory DAN
 * procurement untuk menjawab "sudah dipesan belum".
 */
export const INTENT_MODULES: Record<AssistantIntent, string[]> = {
  all: ["hris", "performance", "payroll", "procurement", "inventory", "pos", "master", "integration"],
  hris: ["hris", "master"],
  performance: ["performance", "hris"],
  payroll: ["payroll", "hris"],
  procurement: ["procurement", "inventory"],
  inventory: ["inventory", "procurement"],
  pos: ["pos", "inventory"],
  master: ["master", "hris"],
  integration: ["integration"],
};

export interface SelectedContext {
  dibuatPada: string;
  modul: Record<string, { label: string; metrics: Record<string, number> }>;
  rincian: Partial<Record<string, Array<Record<string, unknown>>>>;
}

/**
 * Ambil hanya modul yang relevan dengan intent, sekali saja (tanpa duplikasi
 * top-level), berikut rincian baris untuk modul-modul tersebut.
 */
export function selectContextForIntent(
  summary: AssistantSummaryLike,
  intent: AssistantIntent
): SelectedContext {
  const keys = INTENT_MODULES[intent] ?? INTENT_MODULES.all;

  const modul: SelectedContext["modul"] = {};
  for (const key of keys) {
    const found = summary.modules?.[key];
    if (found) modul[key] = found;
  }

  const rincian: SelectedContext["rincian"] = {};
  for (const key of keys) {
    const rows = summary.details?.[key];
    if (rows && rows.length) rincian[key] = rows;
  }

  return { dibuatPada: summary.generatedAt, modul, rincian };
}

/** Ukuran payload (karakter JSON) — dipakai untuk mencatat penghematan. */
export function contextSizeChars(value: unknown): number {
  return JSON.stringify(value ?? null).length;
}
