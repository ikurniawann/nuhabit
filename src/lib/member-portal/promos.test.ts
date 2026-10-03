import { describe, expect, it } from "vitest";
import { isMemberVisiblePromo, selectMemberPromos, type MemberPromoRow } from "./promos";

const TODAY = "2026-10-04";

const row = (overrides: Partial<MemberPromoRow> = {}): MemberPromoRow => ({
  campaign_id: "c1",
  name: "Diskon Oktober",
  description: null,
  discount_type: "percent",
  value: 10,
  max_discount: 20_000,
  min_purchase: 50_000,
  valid_from: "2026-10-01",
  valid_until: "2026-10-31",
  usage_limit: null,
  per_phone_limit: 1,
  scope: "pos",
  is_active: true,
  show_in_member_portal: true,
  code: "OKT10",
  code_is_active: true,
  code_usage_limit: null,
  code_usage_count: 0,
  campaign_used_count: 0,
  my_used_count: 0,
  ...overrides,
});

describe("isMemberVisiblePromo", () => {
  it("tampil bila ditandai, aktif, dalam periode, dan berkuota", () => {
    expect(isMemberVisiblePromo(row(), TODAY)).toBe(true);
    expect(isMemberVisiblePromo(row({ valid_from: null, valid_until: null }), TODAY)).toBe(true);
  });

  it("disembunyikan bila internal atau nonaktif", () => {
    expect(isMemberVisiblePromo(row({ show_in_member_portal: false }), TODAY)).toBe(false);
    expect(isMemberVisiblePromo(row({ is_active: false }), TODAY)).toBe(false);
    expect(isMemberVisiblePromo(row({ code_is_active: false }), TODAY)).toBe(false);
  });

  it("disembunyikan di luar periode (batas inklusif)", () => {
    expect(isMemberVisiblePromo(row({ valid_from: "2026-10-05" }), TODAY)).toBe(false);
    expect(isMemberVisiblePromo(row({ valid_until: "2026-10-03" }), TODAY)).toBe(false);
    expect(isMemberVisiblePromo(row({ valid_from: TODAY, valid_until: TODAY }), TODAY)).toBe(true);
  });

  it("voucher sekali pakai tidak pernah ditampilkan ke semua member", () => {
    expect(isMemberVisiblePromo(row({ code_usage_limit: 1 }), TODAY)).toBe(false);
  });

  it("kuota habis: limit kode menang atas limit campaign", () => {
    expect(isMemberVisiblePromo(row({ code_usage_limit: 50, code_usage_count: 50 }), TODAY)).toBe(false);
    expect(
      isMemberVisiblePromo(row({ code_usage_limit: 50, code_usage_count: 10, usage_limit: 5, campaign_used_count: 5 }), TODAY)
    ).toBe(true);
    expect(isMemberVisiblePromo(row({ usage_limit: 5, campaign_used_count: 5 }), TODAY)).toBe(false);
  });
});

describe("selectMemberPromos", () => {
  it("satu kode per campaign, urutan dipertahankan, jatah member ditandai", () => {
    const promos = selectMemberPromos(
      [
        row({ code: "OKT10", my_used_count: 1 }),
        row({ code: "OKT10B" }),
        row({ campaign_id: "c2", code: "HEMAT", discount_type: "fixed", value: 15_000, max_discount: 99, per_phone_limit: null }),
        row({ campaign_id: "c3", code: "RAHASIA", show_in_member_portal: false }),
      ],
      TODAY
    );
    expect(promos.map((p) => p.code)).toEqual(["OKT10", "HEMAT"]);
    expect(promos[0].used_up).toBe(true);
    expect(promos[1]).toMatchObject({ used_up: false, max_discount: null, per_member_limit: null });
  });

  it("melewati kode campaign yang tidak layak dan memakai kode berikutnya", () => {
    const promos = selectMemberPromos([row({ code: "SEKALI", code_usage_limit: 1 }), row({ code: "PUBLIK" })], TODAY);
    expect(promos.map((p) => p.code)).toEqual(["PUBLIK"]);
  });
});
