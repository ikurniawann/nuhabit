/**
 * Aturan tampilan fitur member (ARK Coin, event, challenge, reward) yang dulu
 * hidup di portal tab lama. Murni: teks lewat `t` (kunci Inggris aplikasi
 * member) supaya bisa diuji tanpa React.
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Angka gaya Indonesia: 12.500 */
export const formatNumber = (value: number) => Math.round(value).toLocaleString("id-ID");

export const formatRp = (value: number) => `Rp ${formatNumber(value)}`;

export type ChallengeMetric = "visits" | "spend";

export function challengeMetricText(t: Translate, metric: ChallengeMetric, value: number): string {
  return metric === "spend" ? formatRp(value) : t("{n} visits", { n: formatNumber(value) });
}

/** "500 XP + ARK worth Rp 10.000"; kosong bila challenge tanpa hadiah. */
export function challengeRewardText(t: Translate, reward: { reward_xp: number; reward_ark_idr: number }): string {
  const parts: string[] = [];
  if (reward.reward_xp > 0) parts.push(`${formatNumber(reward.reward_xp)} XP`);
  if (reward.reward_ark_idr > 0) parts.push(t("ARK worth Rp {n}", { n: formatNumber(reward.reward_ark_idr) }));
  return parts.join(" + ");
}

export type EventSeat = "confirmed" | "waitlist" | "full" | "open";

/** Posisi member di sebuah event: terdaftar, antre, penuh (daftar = waitlist), atau masih ada kursi. */
export function eventSeat(event: {
  booking_status: string | null;
  confirmed_count: number;
  capacity: number;
}): EventSeat {
  if (event.booking_status === "confirmed") return "confirmed";
  if (event.booking_status === "waitlist") return "waitlist";
  return event.confirmed_count >= event.capacity ? "full" : "open";
}

/** Galat nominal top-up bebas; null bila nominal sah. max 0 = tanpa batas atas. */
export function topupAmountError(t: Translate, amount: number, min: number, max: number): string | null {
  if (amount < min) return t("Minimum {amount}", { amount: formatRp(min) });
  if (max > 0 && amount > max) return t("Maximum {amount}", { amount: formatRp(max) });
  return null;
}

/** Persen progres XP menuju tier berikutnya; 100 bila sudah di tier tertinggi. */
export function tierProgressPct(totalXp: number, nextTierMinXp: number | null): number {
  if (!nextTierMinXp || nextTierMinXp <= 0) return 100;
  return Math.min(100, Math.max(0, (totalXp / nextTierMinXp) * 100));
}
