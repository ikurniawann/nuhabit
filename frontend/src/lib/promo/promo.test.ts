import { describe, expect, test } from "vitest";
import {
  computeDiscount,
  evaluatePromo,
  type PromoCampaignRule,
  type PromoCodeState,
  type PromoUsageContext,
} from "./promo";

const campaign = (patch: Partial<PromoCampaignRule> = {}): PromoCampaignRule => ({
  discount_type: "percent",
  value: 10,
  max_discount: null,
  min_purchase: 0,
  valid_from: null,
  valid_until: null,
  usage_limit: null,
  per_phone_limit: 1,
  scope: "ticketing_online",
  is_active: true,
  ...patch,
});

const code = (patch: Partial<PromoCodeState> = {}): PromoCodeState => ({
  is_active: true,
  usage_limit: null,
  usage_count: 0,
  ...patch,
});

const ctx = (patch: Partial<PromoUsageContext> = {}): PromoUsageContext => ({
  today: "2026-08-01",
  channel: "ticketing_online",
  subtotal: 100_000,
  campaignUsedCount: 0,
  phoneUsedCount: 0,
  ...patch,
});

describe("computeDiscount", () => {
  test("percent dibulatkan 2dp", () => {
    expect(computeDiscount(campaign({ value: 12.5 }), 99_999)).toBe(12499.88);
  });

  test("percent kena cap max_discount", () => {
    expect(
      computeDiscount(campaign({ value: 50, max_discount: 20_000 }), 100_000)
    ).toBe(20_000);
  });

  test("fixed tidak boleh melebihi subtotal", () => {
    expect(
      computeDiscount(
        campaign({ discount_type: "fixed", value: 150_000 }),
        100_000
      )
    ).toBe(100_000);
  });

  test("fixed normal", () => {
    expect(
      computeDiscount(campaign({ discount_type: "fixed", value: 25_000 }), 100_000)
    ).toBe(25_000);
  });
});

describe("evaluatePromo", () => {
  test("happy path percent", () => {
    const result = evaluatePromo(campaign(), code(), ctx());
    expect(result).toEqual({ ok: true, discount: 10_000 });
  });

  test("campaign / kode nonaktif → nonaktif", () => {
    expect(evaluatePromo(campaign({ is_active: false }), code(), ctx())).toEqual(
      { ok: false, reason: "nonaktif" }
    );
    expect(evaluatePromo(campaign(), code({ is_active: false }), ctx())).toEqual(
      { ok: false, reason: "nonaktif" }
    );
  });

  test("window inklusif kedua ujung; NULL = terbuka", () => {
    const rule = campaign({ valid_from: "2026-08-01", valid_until: "2026-08-31" });
    expect(evaluatePromo(rule, code(), ctx({ today: "2026-08-01" })).ok).toBe(true);
    expect(evaluatePromo(rule, code(), ctx({ today: "2026-08-31" })).ok).toBe(true);
    expect(evaluatePromo(rule, code(), ctx({ today: "2026-07-31" }))).toEqual({
      ok: false,
      reason: "belum-mulai",
    });
    expect(evaluatePromo(rule, code(), ctx({ today: "2026-09-01" }))).toEqual({
      ok: false,
      reason: "kedaluwarsa",
    });
  });

  test("scope harus cocok; 'semua' menerima channel apa pun", () => {
    expect(evaluatePromo(campaign(), code(), ctx({ channel: "pos" }))).toEqual({
      ok: false,
      reason: "scope",
    });
    expect(
      evaluatePromo(campaign({ scope: "semua" }), code(), ctx({ channel: "pos" })).ok
    ).toBe(true);
  });

  test("min_purchase: di bawah ditolak, pas di batas lolos", () => {
    const rule = campaign({ min_purchase: 100_000 });
    expect(evaluatePromo(rule, code(), ctx({ subtotal: 99_999 }))).toEqual({
      ok: false,
      reason: "min-pembelian",
    });
    expect(evaluatePromo(rule, code(), ctx({ subtotal: 100_000 })).ok).toBe(true);
  });

  test("kuota kode (voucher sekali pakai): habis → kuota-habis", () => {
    expect(
      evaluatePromo(campaign(), code({ usage_limit: 1, usage_count: 1 }), ctx())
    ).toEqual({ ok: false, reason: "kuota-habis" });
    expect(
      evaluatePromo(campaign(), code({ usage_limit: 1, usage_count: 0 }), ctx()).ok
    ).toBe(true);
  });

  test("kuota campaign dipakai bila kode tanpa limit sendiri", () => {
    const rule = campaign({ usage_limit: 100 });
    expect(
      evaluatePromo(rule, code(), ctx({ campaignUsedCount: 100 }))
    ).toEqual({ ok: false, reason: "kuota-habis" });
    expect(
      evaluatePromo(rule, code(), ctx({ campaignUsedCount: 99 })).ok
    ).toBe(true);
  });

  test("limit kode menang atas limit campaign (lebih spesifik)", () => {
    // kode masih sisa walau campaignUsedCount tinggi — kode punya jatah sendiri
    const rule = campaign({ usage_limit: 5 });
    expect(
      evaluatePromo(
        rule,
        code({ usage_limit: 10, usage_count: 7 }),
        ctx({ campaignUsedCount: 5 })
      ).ok
    ).toBe(true);
  });

  test("per_phone_limit: nomor yang sama kena batas; NULL bebas", () => {
    expect(evaluatePromo(campaign(), code(), ctx({ phoneUsedCount: 1 }))).toEqual(
      { ok: false, reason: "limit-nomor" }
    );
    expect(
      evaluatePromo(campaign({ per_phone_limit: null }), code(), ctx({ phoneUsedCount: 9 })).ok
    ).toBe(true);
  });

  test("diskon nol (subtotal 0) → ditolak min-pembelian implisit", () => {
    expect(evaluatePromo(campaign(), code(), ctx({ subtotal: 0 }))).toEqual({
      ok: false,
      reason: "min-pembelian",
    });
  });
});
