/**
 * Helper murni (tanpa dependensi DB) untuk laporan pipeline kandidat —
 * label bahasa Indonesia + formatter nilai yang dipakai pembuat PDF.
 */

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  psikotes: "Psikotes",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  talent_pool: "Talent Pool",
  rejected: "Ditolak",
};

export const RECOMMENDATION_LABELS: Record<string, string> = {
  lolos: "Lolos",
  hold: "Hold",
  tidak_lolos: "Tidak Lolos",
};

export const RELEVANSI_LABELS: Record<string, string> = {
  relevan: "Relevan",
  cukup_relevan: "Cukup Relevan",
  kurang_relevan: "Kurang Relevan",
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: "Terkirim",
  negotiating: "Negosiasi",
  accepted: "Diterima",
  declined: "Ditolak",
  expired: "Kedaluwarsa",
};

/** Status kepegawaian karyawan (hris.employees.employment_status). */
export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  probation: "Probation",
  contract: "Kontrak",
  permanent: "Tetap",
  internship: "Magang",
};

/** Sumber observasi gambar pada insight AI psikotes (drawing). */
export const OBSERVATION_SOURCE_LABELS: Record<string, string> = {
  ai: "Otomatis (AI vision)",
  manual: "Manual (HRD)",
};

export const PSIKOTES_TEST_STATUS_LABELS: Record<string, string> = {
  pending: "Belum dikerjakan",
  in_progress: "Sedang dikerjakan",
  selesai: "Selesai",
  perlu_review: "Perlu Review",
  reviewed: "Sudah Direview",
};

export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "-";
  return map[key] ?? key;
}

export function formatIdr(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "-";
  return `Rp ${new Intl.NumberFormat("id-ID").format(num)}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

export function boolLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value ? "Ya" : "Tidak";
}

/** Skor 0-100 → "87/100"; null → "-". */
export function formatScore(score: number | string | null | undefined): string {
  if (score === null || score === undefined || score === "") return "-";
  const num = typeof score === "string" ? Number(score) : score;
  if (!Number.isFinite(num)) return "-";
  return `${Math.round(num)}/100`;
}

/** Nama file unduhan yang aman: "laporan-pipeline-budi-santoso.pdf". */
export function reportFileName(fullName: string): string {
  const slug = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `laporan-pipeline-${slug || "kandidat"}.pdf`;
}
