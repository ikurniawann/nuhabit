import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRedeemRateLimit,
  evaluateRewardEligibility,
  quotaWindowStart,
  REDEEM_RATE_LIMIT_COUNT,
  resetRedeemRateLimit,
  type MemberEligibilityContext,
  type RewardEligibilityInput,
} from "@/lib/crm/rewards";

const baseReward: RewardEligibilityInput = {
  is_active: true,
  reward_type: "voucher",
  min_xp: 5000,
  required_tier_rank: null,
  stock_total: null,
  stock_redeemed: 0,
  max_redemptions_per_member: null,
  quota_period: "total",
  starts_at: null,
  ends_at: null,
};

const baseMember: MemberEligibilityContext = {
  total_xp: 7000,
  tier_rank: 2,
  redeemed_in_window: 0,
};

describe("evaluateRewardEligibility — XP sebagai syarat, bukan biaya", () => {
  it("member dengan XP di atas min_xp berhak redeem", () => {
    const result = evaluateRewardEligibility(baseReward, baseMember);

    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.xp_needed).toBe(0);
  });

  it("XP tepat sama dengan min_xp tetap berhak (ambang inklusif)", () => {
    const result = evaluateRewardEligibility(baseReward, { ...baseMember, total_xp: 5000 });

    expect(result.eligible).toBe(true);
  });

  it("XP kurang dari min_xp diblokir dan melaporkan kekurangannya", () => {
    const result = evaluateRewardEligibility(baseReward, { ...baseMember, total_xp: 4200 });

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("insufficient_xp");
    expect(result.xp_needed).toBe(800);
    expect(result.reason).toBe("XP kamu belum mencukupi");
  });
});

describe("evaluateRewardEligibility — kuota per member", () => {
  it("kuota belum habis → masih berhak, sisa jatah dilaporkan", () => {
    const result = evaluateRewardEligibility(
      { ...baseReward, max_redemptions_per_member: 2, quota_period: "monthly" },
      { ...baseMember, redeemed_in_window: 1 }
    );

    expect(result.eligible).toBe(true);
    expect(result.remaining_quota).toBe(1);
  });

  it("kuota habis → diblokir", () => {
    const result = evaluateRewardEligibility(
      { ...baseReward, max_redemptions_per_member: 2, quota_period: "monthly" },
      { ...baseMember, redeemed_in_window: 2 }
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("quota_exhausted");
    expect(result.remaining_quota).toBe(0);
  });

  it("kuota null = tanpa batas", () => {
    const result = evaluateRewardEligibility(baseReward, {
      ...baseMember,
      redeemed_in_window: 99,
    });

    expect(result.eligible).toBe(true);
    expect(result.remaining_quota).toBeNull();
  });
});

describe("evaluateRewardEligibility — stok, tier, status, periode", () => {
  it("stok habis diblokir", () => {
    const result = evaluateRewardEligibility(
      { ...baseReward, stock_total: 10, stock_redeemed: 10 },
      baseMember
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("out_of_stock");
    expect(result.remaining_stock).toBe(0);
  });

  it("tier di bawah syarat diblokir", () => {
    const result = evaluateRewardEligibility(
      { ...baseReward, required_tier_rank: 3 },
      { ...baseMember, tier_rank: 2 }
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("tier_too_low");
  });

  it("reward nonaktif diblokir walau syarat lain terpenuhi", () => {
    const result = evaluateRewardEligibility({ ...baseReward, is_active: false }, baseMember);

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("inactive");
  });

  it("di luar periode aktif diblokir", () => {
    const now = new Date("2026-07-20T10:00:00+07:00");

    const belumMulai = evaluateRewardEligibility(
      { ...baseReward, starts_at: "2026-08-01T00:00:00+07:00" },
      baseMember,
      now
    );
    const sudahBerakhir = evaluateRewardEligibility(
      { ...baseReward, ends_at: "2026-07-01T00:00:00+07:00" },
      baseMember,
      now
    );

    expect(belumMulai.blockers).toContain("not_started");
    expect(sudahBerakhir.blockers).toContain("ended");
  });
});

describe("quotaWindowStart — batas kalender WIB, bebas TZ host", () => {
  // Ekspektasi ditulis sebagai instan absolut ber-offset +07:00 agar tes tetap
  // benar walau proses berjalan di TZ apa pun (UTC di CI, WIB di server dev).
  const now = new Date("2026-07-20T15:30:00+07:00");

  it("total → null (tanpa jendela waktu)", () => {
    expect(quotaWindowStart("total", now)).toBeNull();
  });

  it("daily → tengah malam WIB hari ini", () => {
    expect(quotaWindowStart("daily", now)).toEqual(new Date("2026-07-20T00:00:00+07:00"));
  });

  it("monthly → tanggal 1 WIB bulan berjalan", () => {
    expect(quotaWindowStart("monthly", now)).toEqual(new Date("2026-07-01T00:00:00+07:00"));
  });

  it("yearly → 1 Januari WIB tahun berjalan", () => {
    expect(quotaWindowStart("yearly", now)).toEqual(new Date("2026-01-01T00:00:00+07:00"));
  });

  it("dini hari WIB tetap masuk hari yang sama (kasus 00:30 WIB = 17:30 UTC kemarin)", () => {
    const diniHari = new Date("2026-07-20T00:30:00+07:00");
    expect(quotaWindowStart("daily", diniHari)).toEqual(new Date("2026-07-20T00:00:00+07:00"));
  });

  it("tepat sebelum tengah malam WIB masih hari sebelumnya", () => {
    const jelangTengahMalam = new Date("2026-07-20T23:59:00+07:00");
    expect(quotaWindowStart("daily", jelangTengahMalam)).toEqual(
      new Date("2026-07-20T00:00:00+07:00")
    );
  });

  it("pergantian bulan: 1 Agt 00:30 WIB → jendela bulanan mulai 1 Agt", () => {
    const awalAgustus = new Date("2026-08-01T00:30:00+07:00");
    expect(quotaWindowStart("monthly", awalAgustus)).toEqual(
      new Date("2026-08-01T00:00:00+07:00")
    );
  });
});

describe("evaluateRewardEligibility — reward avatar tidak bisa di-redeem", () => {
  it("id avatar yang diselundupkan langsung tetap diblokir", () => {
    const result = evaluateRewardEligibility(
      { ...baseReward, reward_type: "avatar" },
      baseMember
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain("not_redeemable");
    expect(result.reason).toBe("Reward ini tidak bisa ditukar");
  });
});

describe("checkRedeemRateLimit", () => {
  beforeEach(() => resetRedeemRateLimit());

  it("mengizinkan percobaan sampai batas, lalu menolak", () => {
    const now = 1_000_000;
    for (let i = 0; i < REDEEM_RATE_LIMIT_COUNT; i += 1) {
      expect(checkRedeemRateLimit("cust-1", now).allowed).toBe(true);
    }

    const blocked = checkRedeemRateLimit("cust-1", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("kuota terpisah per member", () => {
    const now = 1_000_000;
    for (let i = 0; i < REDEEM_RATE_LIMIT_COUNT; i += 1) {
      checkRedeemRateLimit("cust-1", now);
    }

    expect(checkRedeemRateLimit("cust-2", now).allowed).toBe(true);
  });

  it("jendela bergulir: setelah lewat 1 menit boleh lagi", () => {
    const now = 1_000_000;
    for (let i = 0; i < REDEEM_RATE_LIMIT_COUNT; i += 1) {
      checkRedeemRateLimit("cust-1", now);
    }

    expect(checkRedeemRateLimit("cust-1", now + 61_000).allowed).toBe(true);
  });
});
