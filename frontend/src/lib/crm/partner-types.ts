/** Konstanta partner loyalty yang aman dipakai di klien (tanpa crypto). */

export const PARTNER_TYPES = ["photobooth", "studio_game", "other"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  photobooth: "Photobooth",
  studio_game: "Studio game",
  other: "Lainnya",
};

/** XP maksimal satu event: nilai lebih besar adalah bug atau serangan. */
export const PARTNER_XP_CAP = 1000;
