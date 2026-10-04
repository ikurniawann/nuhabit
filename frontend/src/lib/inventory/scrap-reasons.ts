/** Alasan scrap/write-off (aman dipakai di client). */
export const SCRAP_REASONS = {
  expired: "Kedaluwarsa",
  damaged: "Rusak",
  spoiled: "Basi / busuk",
  sample: "Sampel / R&D",
  other: "Lainnya",
} as const;

export type ScrapReason = keyof typeof SCRAP_REASONS;

export const SCRAP_REASON_OPTIONS = (Object.keys(SCRAP_REASONS) as ScrapReason[]).map((value) => ({
  value,
  label: SCRAP_REASONS[value],
}));
