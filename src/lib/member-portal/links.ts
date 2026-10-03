/**
 * Tautan dalam portal member. Pengumuman, notifikasi, dan web push menyimpan
 * tujuan sebagai string pendek ("events", "promo:KOPI10"), bukan URL bebas,
 * supaya admin tidak bisa mengarahkan member ke situs luar dan portal bisa
 * membukanya tanpa memuat ulang halaman.
 */

export const PORTAL_TABS = [
  "home",
  "coins",
  "topup",
  "history",
  "profile",
  "events",
  "challenges",
  "promos",
  "rewards",
  "badges",
  "collection",
  "reviews",
  "classes",
  "my-classes",
  "credits",
  "workout",
  "races",
  "coaches",
] as const;

export type PortalTab = (typeof PORTAL_TABS)[number];

export type PortalLink = { kind: "tab"; tab: PortalTab } | { kind: "promo"; code: string };

const PROMO_CODE_RE = /^[A-Za-z0-9-]{3,40}$/;

/** Pilihan tujuan di composer pengumuman admin (promo:<kode> diketik terpisah). */
export const PORTAL_LINK_OPTIONS: Array<{ value: PortalTab; label: string }> = [
  { value: "classes", label: "Jadwal kelas" },
  { value: "my-classes", label: "Kelas saya" },
  { value: "credits", label: "Kredit kelas" },
  { value: "workout", label: "Workout HYROX" },
  { value: "races", label: "Race HYROX" },
  { value: "coaches", label: "Coach" },
  { value: "events", label: "Event & kelas" },
  { value: "challenges", label: "Challenge" },
  { value: "promos", label: "Daftar promo" },
  { value: "coins", label: "ARK Coin" },
  { value: "topup", label: "Top-up ARK Coin" },
  { value: "rewards", label: "Reward" },
  { value: "badges", label: "Badge" },
  { value: "collection", label: "Koleksi & wallpaper" },
  { value: "reviews", label: "Ulasan" },
  { value: "history", label: "Riwayat transaksi" },
  { value: "profile", label: "Profil" },
];

export function parsePortalLink(raw: string | null | undefined): PortalLink | null {
  const value = (raw ?? "").trim();
  if (value.toLowerCase().startsWith("promo:")) {
    const code = value.slice("promo:".length).trim();
    return PROMO_CODE_RE.test(code) ? { kind: "promo", code: code.toUpperCase() } : null;
  }
  return (PORTAL_TABS as readonly string[]).includes(value) ? { kind: "tab", tab: value as PortalTab } : null;
}

export const isPortalLink = (raw: string | null | undefined) => parsePortalLink(raw) !== null;

/** URL yang membuka portal langsung di tujuan (dipakai klik notifikasi push). */
export function portalUrl(link: string | null | undefined): string {
  return parsePortalLink(link) ? `/member?go=${encodeURIComponent(link!.trim())}` : "/member";
}

/** Tujuan bawaan notifikasi sistem menurut jenisnya. */
export function linkForNotificationType(type: string): string | null {
  if (type.startsWith("booking_") || type.startsWith("waitlist_") || type.startsWith("event_")) return "events";
  if (type.startsWith("challenge_")) return "challenges";
  if (type.startsWith("topup")) return "topup";
  if (type.startsWith("review")) return "reviews";
  if (type === "promo") return "promos";
  return null;
}
