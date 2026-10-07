import type { PsikotesSessionTest } from "../types";

/** Label & badge status tes psikotes utk panel HRD (bahasa HR, bukan enum). */
export const PSIKOTES_TEST_STATUS: Record<
  PsikotesSessionTest["status"],
  { label: string; badge: string }
> = {
  pending: {
    label: "Belum dikerjakan",
    badge: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
  },
  in_progress: {
    label: "Sedang berjalan",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
  },
  selesai: {
    label: "Selesai",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  perlu_review: {
    label: "Perlu review manual",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  },
  reviewed: {
    label: "Sudah direview",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  },
};
