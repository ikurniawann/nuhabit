import { describe, expect, test } from "vitest";
import {
  PROMO_REJECT_LABELS,
  PROMO_REJECT_MESSAGES,
  evaluatePromo,
  promoEligibleSubtotal,
  type PromoCampaignRule,
  type PromoCodeState,
  type PromoUsageContext,
} from "./promo";

const LATTE = "11111111-1111-4111-8111-111111111111";
const CAKE = "22222222-2222-4222-8222-222222222222";
const MUG = "33333333-3333-4333-8333-333333333333";
const COFFEE_CAT = "c0ffee00-0000-4000-8000-000000000001";
const PASTRY_CAT = "c0ffee00-0000-4000-8000-000000000002";

const campaign = (patch: Partial<PromoCampaignRule> = {}): PromoCampaignRule => ({
  discount_type: "percent",
  value: 10,
  max_discount: null,
  min_purchase: 0,
  valid_from: null,
  valid_until: null,
  usage_limit: null,
  per_phone_limit: null,
  scope: "pos",
  is_active: true,
  ...patch,
});

const code: PromoCodeState = { is_active: true, usage_limit: null, usage_count: 0 };

const lines = [
  { productId: LATTE, categoryId: COFFEE_CAT, amount: 40_000 },
  { productId: CAKE, categoryId: PASTRY_CAT, amount: 30_000 },
  { productId: MUG, categoryId: null, amount: 80_000 },
];

const ctx = (patch: Partial<PromoUsageContext> = {}): PromoUsageContext => ({
  today: "2026-10-04",
  channel: "pos",
  subtotal: 150_000,
  campaignUsedCount: 0,
  phoneUsedCount: 0,
  lines,
  ...patch,
});

describe("promoEligibleSubtotal", () => {
  test("tanpa target = seluruh subtotal", () => {
    expect(promoEligibleSubtotal(campaign(), 150_000, lines)).toBe(150_000);
  });

  test("target produk hanya menjumlah baris produk itu", () => {
    expect(
      promoEligibleSubtotal(campaign({ target_product_ids: [LATTE] }), 150_000, lines)
    ).toBe(40_000);
  });

  test("target kategori + produk digabung, baris tidak dihitung dua kali", () => {
    expect(
      promoEligibleSubtotal(
        campaign({ target_product_ids: [LATTE, MUG], target_category_ids: [COFFEE_CAT] }),
        150_000,
        lines
      )
    ).toBe(120_000);
  });

  test("baris tanpa kategori tidak cocok dgn target kategori", () => {
    expect(
      promoEligibleSubtotal(campaign({ target_category_ids: [PASTRY_CAT] }), 150_000, lines)
    ).toBe(30_000);
  });
});

describe("evaluatePromo — diskon per baris", () => {
  test("persen dihitung dari baris yang cocok saja", () => {
    const result = evaluatePromo(
      campaign({ value: 50, target_category_ids: [COFFEE_CAT] }),
      code,
      ctx()
    );
    expect(result).toEqual({ ok: true, discount: 20_000 });
  });

  test("nominal tetap dijepit ke nilai baris yang cocok", () => {
    const result = evaluatePromo(
      campaign({ discount_type: "fixed", value: 50_000, target_product_ids: [CAKE] }),
      code,
      ctx()
    );
    expect(result).toEqual({ ok: true, discount: 30_000 });
  });

  test("tidak ada baris cocok → produk-tidak-sesuai", () => {
    const result = evaluatePromo(
      campaign({ target_product_ids: [CAKE] }),
      code,
      ctx({ lines: [lines[0]] })
    );
    expect(result).toEqual({ ok: false, reason: "produk-tidak-sesuai" });
  });

  test("kode bertarget tanpa data baris (mis. tiket online) ditolak", () => {
    const result = evaluatePromo(
      campaign({ scope: "semua", target_product_ids: [CAKE] }),
      code,
      ctx({ channel: "ticketing_online", lines: undefined })
    );
    expect(result).toEqual({ ok: false, reason: "produk-tidak-sesuai" });
  });

  test("min pembelian tetap dibanding subtotal transaksi, bukan basis baris", () => {
    const result = evaluatePromo(
      campaign({ min_purchase: 100_000, target_product_ids: [CAKE] }),
      code,
      ctx()
    );
    expect(result).toEqual({ ok: true, discount: 3_000 });
  });

  test("cap max_discount berlaku pada basis baris", () => {
    const result = evaluatePromo(
      campaign({ value: 50, max_discount: 10_000, target_product_ids: [MUG] }),
      code,
      ctx()
    );
    expect(result).toEqual({ ok: true, discount: 10_000 });
  });
});

describe("evaluatePromo — kelayakan member", () => {
  test("semua (default) tidak butuh member", () => {
    expect(evaluatePromo(campaign(), code, ctx({ member: null })).ok).toBe(true);
  });

  test("khusus member menolak transaksi tanpa member", () => {
    expect(evaluatePromo(campaign({ eligibility: "member" }), code, ctx())).toEqual({
      ok: false,
      reason: "khusus-member",
    });
  });

  test("khusus member lolos utk member lama", () => {
    const result = evaluatePromo(
      campaign({ eligibility: "member" }),
      code,
      ctx({ member: { priorPaidOrders: 12, joinedDaysAgo: 400 } })
    );
    expect(result.ok).toBe(true);
  });

  test("member baru: transaksi pertama lolos", () => {
    const result = evaluatePromo(
      campaign({ eligibility: "member_baru" }),
      code,
      ctx({ member: { priorPaidOrders: 0, joinedDaysAgo: 900 } })
    );
    expect(result.ok).toBe(true);
  });

  test("member baru: sudah pernah order lunas ditolak", () => {
    const result = evaluatePromo(
      campaign({ eligibility: "member_baru" }),
      code,
      ctx({ member: { priorPaidOrders: 1, joinedDaysAgo: 2 } })
    );
    expect(result).toEqual({ ok: false, reason: "bukan-member-baru" });
  });

  test("member baru + batas hari: keduanya wajib terpenuhi", () => {
    const rule = campaign({ eligibility: "member_baru", new_member_days: 30 });
    expect(
      evaluatePromo(rule, code, ctx({ member: { priorPaidOrders: 0, joinedDaysAgo: 30 } })).ok
    ).toBe(true);
    expect(
      evaluatePromo(rule, code, ctx({ member: { priorPaidOrders: 0, joinedDaysAgo: 31 } }))
    ).toEqual({ ok: false, reason: "bukan-member-baru" });
  });

  test("member baru tanpa member dipilih → khusus-member", () => {
    expect(evaluatePromo(campaign({ eligibility: "member_baru" }), code, ctx())).toEqual({
      ok: false,
      reason: "khusus-member",
    });
  });

  test("urutan cek: kelayakan sebelum min pembelian", () => {
    const result = evaluatePromo(
      campaign({ eligibility: "member", min_purchase: 1_000_000 }),
      code,
      ctx()
    );
    expect(result).toEqual({ ok: false, reason: "khusus-member" });
  });
});

describe("pesan penolakan kasir", () => {
  test("setiap alasan punya pesan dan label pendek", () => {
    for (const reason of Object.keys(PROMO_REJECT_MESSAGES)) {
      expect(PROMO_REJECT_LABELS[reason as keyof typeof PROMO_REJECT_LABELS]).toBeTruthy();
    }
    expect(Object.keys(PROMO_REJECT_LABELS).sort()).toEqual(
      Object.keys(PROMO_REJECT_MESSAGES).sort()
    );
  });
});
