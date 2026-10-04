/**
 * Teks syarat badge di portal. crm.crm_badges.metric menentukan satuannya;
 * threshold kosong untuk badge XP jatuh ke min_lifetime_xp (badge lama).
 * Mengembalikan kunci i18n aplikasi member (Inggris) + variabel.
 */

export type BadgeMetric = "lifetime_xp" | "visits" | "spend_idr" | "streak_weeks" | "manual";

export interface BadgeTarget {
  key: string;
  vars?: { n: string };
}

const angka = (value: number) => Math.round(value).toLocaleString("id-ID");

export function badgeTarget(badge: { metric?: string | null; threshold: number | null; min_lifetime_xp: number }): BadgeTarget {
  const n = badge.threshold ?? 0;
  switch (badge.metric) {
    case "manual":
      return { key: "Given by the team" };
    case "visits":
      return { key: "{n} visits", vars: { n: angka(n) } };
    case "spend_idr":
      return { key: "Rp {n}", vars: { n: angka(n) } };
    case "streak_weeks":
      return { key: "{n}-week streak", vars: { n: angka(n) } };
    default:
      return { key: "{n} XP", vars: { n: angka(badge.threshold ?? badge.min_lifetime_xp) } };
  }
}
