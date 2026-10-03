/**
 * Aturan badge per metrik (murni, tanpa DB). Badge lama berbasis lifetime XP
 * tetap memakai `min_lifetime_xp`; metrik lain memakai `threshold` dan
 * dihitung dari order lunas member. Badge `manual` hanya diberikan admin.
 */

export const BADGE_METRICS = ["lifetime_xp", "visits", "spend_idr", "streak_weeks", "manual"] as const;
export type BadgeMetric = (typeof BADGE_METRICS)[number];

export const BADGE_METRIC_LABELS: Record<BadgeMetric, string> = {
  lifetime_xp: "Lifetime XP",
  visits: "Jumlah kunjungan",
  spend_idr: "Total belanja (Rp)",
  streak_weeks: "Minggu berturut-turut",
  manual: "Manual (diberikan admin)",
};

export interface BadgeRule {
  metric: BadgeMetric;
  threshold: number | string | null;
  min_lifetime_xp: number | string | null;
}

export interface MemberBadgeStats {
  lifetimeXp: number;
  /** Hari (WIB) berbeda dengan order lunas. */
  visits: number;
  spendIdr: number;
  /** Rentetan minggu terpanjang dengan minimal satu order lunas. */
  streakWeeks: number;
}

export function isBadgeMetric(value: unknown): value is BadgeMetric {
  return typeof value === "string" && (BADGE_METRICS as readonly string[]).includes(value);
}

/** Ambang efektif; null untuk badge manual (tidak pernah otomatis). */
export function badgeThreshold(rule: BadgeRule): number | null {
  if (rule.metric === "manual") return null;
  const raw = rule.metric === "lifetime_xp" ? rule.min_lifetime_xp : rule.threshold;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function badgeMetricValue(metric: BadgeMetric, stats: MemberBadgeStats): number | null {
  switch (metric) {
    case "lifetime_xp":
      return stats.lifetimeXp;
    case "visits":
      return stats.visits;
    case "spend_idr":
      return stats.spendIdr;
    case "streak_weeks":
      return stats.streakWeeks;
    case "manual":
      return null;
  }
}

export function isBadgeEarned(rule: BadgeRule, stats: MemberBadgeStats): boolean {
  const threshold = badgeThreshold(rule);
  const value = badgeMetricValue(rule.metric, stats);
  return threshold !== null && value !== null && value >= threshold;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rentetan minggu berturut-turut terpanjang. `weekStarts` = tanggal awal
 * minggu (YYYY-MM-DD, mis. hasil date_trunc('week')); duplikat & urutan
 * acak aman.
 */
export function longestWeeklyStreak(weekStarts: string[]): number {
  const times = [...new Set(weekStarts)]
    .map((d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < times.length; i++) {
    run = i > 0 && times[i] - times[i - 1] === WEEK_MS ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Ringkas ambang badge untuk ditampilkan admin/member. */
export function describeBadgeRule(rule: BadgeRule): string {
  const threshold = badgeThreshold(rule);
  if (threshold === null) return "Diberikan manual oleh admin";
  const n = threshold.toLocaleString("id-ID");
  switch (rule.metric) {
    case "lifetime_xp":
      return `${n} lifetime XP`;
    case "visits":
      return `${n} kunjungan`;
    case "spend_idr":
      return `Belanja Rp ${n}`;
    case "streak_weeks":
      return `${n} minggu berturut-turut`;
    default:
      return n;
  }
}
