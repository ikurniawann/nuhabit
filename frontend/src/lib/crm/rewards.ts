/**
 * EPIC-011 Fase F — aturan kelayakan redeem reward.
 *
 * Prinsip utama (keputusan owner, Fase B): XP adalah skor seumur hidup dan
 * TIDAK PERNAH berkurang. Karena itu `min_xp` sebuah reward adalah *syarat
 * kelayakan* (compliance), bukan harga. Redeem tidak menyentuh total_xp.
 *
 * Yang membatasi berapa kali member boleh redeem adalah kuota yang diatur
 * admin: `max_redemptions_per_member` di dalam jendela `quota_period`.
 */

export const QUOTA_PERIODS = ["total", "daily", "monthly", "yearly"] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export const QUOTA_PERIOD_LABELS: Record<QuotaPeriod, string> = {
  total: "Total (seumur hidup)",
  daily: "Per hari",
  monthly: "Per bulan",
  yearly: "Per tahun",
};

/** Status redemption yang masih "memakai" jatah kuota & stok. */
export const ACTIVE_REDEMPTION_STATUSES = ["pending", "approved", "fulfilled"] as const;

export type RewardEligibilityInput = {
  is_active: boolean;
  /** Avatar punya alur inventory sendiri, tidak boleh lewat redemption. */
  reward_type: string;
  min_xp: number;
  required_tier_rank: number | null;
  stock_total: number | null;
  stock_redeemed: number;
  max_redemptions_per_member: number | null;
  quota_period: QuotaPeriod;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
};

export type MemberEligibilityContext = {
  total_xp: number;
  tier_rank: number | null;
  /** Jumlah redemption aktif member untuk reward ini di dalam jendela kuota. */
  redeemed_in_window: number;
};

export type EligibilityBlocker =
  | "not_redeemable"
  | "inactive"
  | "not_started"
  | "ended"
  | "out_of_stock"
  | "insufficient_xp"
  | "tier_too_low"
  | "quota_exhausted";

export type EligibilityResult = {
  eligible: boolean;
  blockers: EligibilityBlocker[];
  /** Alasan utama dalam bahasa Indonesia untuk ditampilkan ke member. */
  reason: string | null;
  xp_needed: number;
  remaining_stock: number | null;
  remaining_quota: number | null;
};

const BLOCKER_MESSAGES: Record<EligibilityBlocker, string> = {
  not_redeemable: "Reward ini tidak bisa ditukar",
  inactive: "Reward sedang tidak tersedia",
  not_started: "Periode reward belum dimulai",
  ended: "Periode reward sudah berakhir",
  out_of_stock: "Stok reward habis",
  insufficient_xp: "XP kamu belum mencukupi",
  tier_too_low: "Tier kamu belum memenuhi syarat",
  quota_exhausted: "Jatah redeem kamu untuk reward ini sudah habis",
};

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Venue beroperasi di WIB; batas kalender kuota mengikuti zona ini. */
export const WIB_OFFSET_HOURS = 7;

/**
 * Awal jendela kuota sebagai instan absolut (UTC). `total` mengembalikan null
 * (tanpa batas waktu). Batas hari/bulan/tahun dihitung eksplisit di WIB lewat
 * aritmetika UTC — bukan getter lokal — supaya hasilnya sama walau proses Node
 * berjalan di infra ber-TZ UTC (pola yang sama dipakai modul HRIS/KPI).
 */
export function quotaWindowStart(period: QuotaPeriod, now: Date = new Date()): Date | null {
  if (period === "total") return null;

  // Geser ke "jam dinding WIB" supaya komponen tanggalnya bisa dibaca via UTC.
  const wib = new Date(now.getTime() + WIB_OFFSET_HOURS * 3600_000);
  const year = wib.getUTCFullYear();
  const month = period === "yearly" ? 0 : wib.getUTCMonth();
  const day = period === "daily" ? wib.getUTCDate() : 1;

  // Tengah malam WIB = 17:00 UTC hari sebelumnya → kurangi offsetnya kembali.
  return new Date(Date.UTC(year, month, day) - WIB_OFFSET_HOURS * 3600_000);
}

export function evaluateRewardEligibility(
  reward: RewardEligibilityInput,
  member: MemberEligibilityContext,
  now: Date = new Date()
): EligibilityResult {
  const blockers: EligibilityBlocker[] = [];

  // Avatar dikelola lewat crm_member_avatar_inventory, bukan redemption —
  // cegah id avatar diselundupkan langsung ke endpoint redeem.
  if (reward.reward_type === "avatar") blockers.push("not_redeemable");
  if (!reward.is_active) blockers.push("inactive");

  const startsAt = toDate(reward.starts_at);
  const endsAt = toDate(reward.ends_at);
  if (startsAt && now < startsAt) blockers.push("not_started");
  if (endsAt && now > endsAt) blockers.push("ended");

  const remainingStock =
    reward.stock_total == null
      ? null
      : Math.max(0, reward.stock_total - (reward.stock_redeemed || 0));
  if (remainingStock !== null && remainingStock <= 0) blockers.push("out_of_stock");

  const minXp = Math.max(0, reward.min_xp || 0);
  const xpNeeded = Math.max(0, minXp - (member.total_xp || 0));
  if (xpNeeded > 0) blockers.push("insufficient_xp");

  if (
    reward.required_tier_rank !== null &&
    (member.tier_rank ?? 0) < reward.required_tier_rank
  ) {
    blockers.push("tier_too_low");
  }

  const remainingQuota =
    reward.max_redemptions_per_member == null
      ? null
      : Math.max(0, reward.max_redemptions_per_member - (member.redeemed_in_window || 0));
  if (remainingQuota !== null && remainingQuota <= 0) blockers.push("quota_exhausted");

  return {
    eligible: blockers.length === 0,
    blockers,
    reason: blockers.length > 0 ? BLOCKER_MESSAGES[blockers[0]] : null,
    xp_needed: xpNeeded,
    remaining_stock: remainingStock,
    remaining_quota: remainingQuota,
  };
}

export function eligibilityBlockerMessage(blocker: EligibilityBlocker): string {
  return BLOCKER_MESSAGES[blocker];
}

/**
 * Rate limit redeem portal member (selaras pola OTP Fase D). Membatasi jumlah
 * percobaan per member, termasuk yang gagal — tiap percobaan memakai satu
 * koneksi pool bertransaksi, jadi flood harus dicegah sebelum menyentuh DB.
 */
export const REDEEM_RATE_LIMIT_COUNT = 10;
export const REDEEM_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const redeemAttempts = new Map<string, number[]>();

export function checkRedeemRateLimit(
  customerId: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterMs: number } {
  const windowStart = now - REDEEM_RATE_LIMIT_WINDOW_MS;
  const recent = (redeemAttempts.get(customerId) ?? []).filter((at) => at > windowStart);

  if (recent.length >= REDEEM_RATE_LIMIT_COUNT) {
    redeemAttempts.set(customerId, recent);
    return { allowed: false, retryAfterMs: recent[0] + REDEEM_RATE_LIMIT_WINDOW_MS - now };
  }

  recent.push(now);
  redeemAttempts.set(customerId, recent);

  // Buang entri member lain yang sudah kedaluwarsa agar map tidak tumbuh terus.
  if (redeemAttempts.size > 1000) {
    for (const [key, stamps] of redeemAttempts) {
      if (stamps.every((at) => at <= windowStart)) redeemAttempts.delete(key);
    }
  }

  return { allowed: true, retryAfterMs: 0 };
}

/** Hanya untuk test — mengosongkan state rate limit in-memory. */
export function resetRedeemRateLimit() {
  redeemAttempts.clear();
}
