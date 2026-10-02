/**
 * Logika murni NüHabit Progress (EPIC-066) — tier efektif, benefit booking,
 * streak mingguan, jam sepi, alias leaderboard. Tanpa DB supaya mudah diuji.
 */

export type MemberStatus = "active" | "inactive" | "suspended" | "merged" | "banned";

export interface TierBenefits {
  /** Booking dibuka X hari lebih awal dari Aturan Booking. */
  early_booking_days: number;
  /** Batas batal khusus tier (jam); null = ikut Aturan Booking. Hanya dipakai bila lebih longgar. */
  cancel_window_hours: number | null;
  /** Didahulukan saat naik dari waitlist. */
  waitlist_priority: boolean;
}

export interface Tier {
  id: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number;
  discount_percent: number;
  display_color: string | null;
  benefits: TierBenefits;
}

export const NO_BENEFITS: TierBenefits = { early_booking_days: 0, cancel_window_hours: null, waitlist_priority: false };

export function parseBenefits(metadata: unknown): TierBenefits {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const cw = m.cancel_window_hours;
  return {
    early_booking_days: Math.max(0, Math.floor(Number(m.early_booking_days) || 0)),
    cancel_window_hours: cw === null || cw === undefined || cw === "" ? null : Math.max(0, Number(cw)),
    waitlist_priority: m.waitlist_priority === true,
  };
}

/** Status yang membekukan tier, benefit, XP, dan reward (keputusan owner). */
export function isFrozen(status: MemberStatus | null | undefined): boolean {
  return status === "suspended" || status === "banned";
}

/**
 * Tier dari XP seumur hidup; member diblokir/banned turun ke tier dasar tanpa
 * benefit. `next` = tier berikutnya + XP yang masih dibutuhkan.
 */
export function resolveTier(tiers: Tier[], lifetimeXp: number, status: MemberStatus | null | undefined) {
  const sorted = [...tiers].sort((a, b) => a.min_lifetime_xp - b.min_lifetime_xp);
  const base = sorted[0] ?? null;
  const earned = [...sorted].reverse().find((t) => lifetimeXp >= t.min_lifetime_xp) ?? base;
  const frozen = isFrozen(status);
  const current = frozen ? base : earned;
  const nextTier = earned ? sorted.find((t) => t.min_lifetime_xp > earned.min_lifetime_xp) ?? null : null;
  return {
    tier: current,
    earnedTier: earned,
    frozen,
    benefits: frozen || !current ? NO_BENEFITS : current.benefits,
    next: nextTier ? { tier: nextTier, xp_needed: Math.max(nextTier.min_lifetime_xp - lifetimeXp, 0) } : null,
  };
}

/** Aturan booking efektif untuk member sesuai benefit tier. */
export function applyBookingBenefits<T extends { booking_open_days: number; cancel_window_hours: number }>(settings: T, b: TierBenefits): T {
  return {
    ...settings,
    booking_open_days: settings.booking_open_days + b.early_booking_days,
    cancel_window_hours:
      b.cancel_window_hours !== null && b.cancel_window_hours < settings.cancel_window_hours ? b.cancel_window_hours : settings.cancel_window_hours,
  };
}

/** Senin (ISO) dari minggu tanggal ini — kunci minggu untuk streak. */
export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (wd - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Streak minggu berturut-turut (berakhir di minggu `weekStart`) dengan minimal
 * `minSessions` sesi hadir per minggu. Input: tanggal-tanggal sesi hadir.
 */
export function consecutiveStreakWeeks(attendedDates: string[], weekStart: string, minSessions: number): number {
  const perWeek = new Map<string, number>();
  for (const d of attendedDates) {
    const w = isoWeekStart(d);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  let streak = 0;
  const cursor = new Date(`${weekStart}T00:00:00Z`);
  while ((perWeek.get(cursor.toISOString().slice(0, 10)) ?? 0) >= minSessions) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return streak;
}

/** Sesi mulai di dalam jendela jam sepi [start, end). */
export function isOffpeak(startTime: string, window: { start?: unknown; end?: unknown } | null | undefined): boolean {
  const start = typeof window?.start === "string" ? window.start : null;
  const end = typeof window?.end === "string" ? window.end : null;
  if (!start || !end) return false;
  const t = startTime.slice(0, 5);
  return t >= start && t < end;
}

/** XP dari aturan (fixed / per_amount). */
export function ruleXp(rule: { xp_mode: string; xp_value: number; amount_step: number }, amount = 0): number {
  if (rule.xp_mode === "fixed") return Math.max(0, Math.floor(rule.xp_value));
  if (rule.xp_mode === "per_amount") return Math.max(0, Math.floor(amount / Math.max(1, rule.amount_step)) * rule.xp_value);
  return 0;
}

/** "Maya Kartika Sari" → "Maya K." (privasi leaderboard). */
export function leaderboardAlias(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Atlet";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}
