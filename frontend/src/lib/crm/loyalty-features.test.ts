import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOYALTY_FEATURES,
  filterMenusByLoyaltyFeatures,
  isMenuCodeEnabled,
  isPathEnabled,
  isPaymentMethodEnabled,
  parseLoyaltyFeatures,
} from "./loyalty-features";

const ALL_ON = { arkCoin: true, xp: true };
const ARK_OFF = { arkCoin: false, xp: true };
const XP_OFF = { arkCoin: true, xp: false };
const ALL_OFF = { arkCoin: false, xp: false };

describe("parseLoyaltyFeatures", () => {
  it("key belum ada (instance lama) = aktif, perilaku lama", () => {
    expect(parseLoyaltyFeatures([])).toEqual(DEFAULT_LOYALTY_FEATURES);
    expect(DEFAULT_LOYALTY_FEATURES).toEqual(ALL_ON);
  });

  it("membaca boolean jsonb maupun string", () => {
    expect(
      parseLoyaltyFeatures([
        { key: "ark_coin_enabled", value: false },
        { key: "xp_enabled", value: "true" },
      ])
    ).toEqual(ARK_OFF);
    expect(parseLoyaltyFeatures([{ key: "xp_enabled", value: "false" }])).toEqual(XP_OFF);
  });

  it("nilai rusak jatuh ke default aktif, bukan mematikan fitur", () => {
    expect(parseLoyaltyFeatures([{ key: "ark_coin_enabled", value: { oops: 1 } }])).toEqual(ALL_ON);
  });
});

describe("menu", () => {
  it("ARK mati → Topup & Unlink Card hilang, pengaturan ARK & XP tetap (XP masih aktif)", () => {
    expect(isMenuCodeEnabled("pos.loyalty.topup", ARK_OFF)).toBe(false);
    expect(isMenuCodeEnabled("pos.loyalty.unlink-card", ARK_OFF)).toBe(false);
    expect(isMenuCodeEnabled("pos.loyalty.settings", ARK_OFF)).toBe(true);
    expect(isMenuCodeEnabled("crm.loyalty.rewards", ARK_OFF)).toBe(true);
  });

  it("XP mati → Rewards, Avatars, Badges hilang; menu ARK tetap", () => {
    expect(isMenuCodeEnabled("crm.loyalty.rewards", XP_OFF)).toBe(false);
    expect(isMenuCodeEnabled("crm.loyalty.avatars", XP_OFF)).toBe(false);
    expect(isMenuCodeEnabled("crm.badges", XP_OFF)).toBe(false);
    expect(isMenuCodeEnabled("pos.loyalty.topup", XP_OFF)).toBe(true);
  });

  it("dua-duanya mati → menu gabungan ARK & XP ikut hilang", () => {
    expect(isMenuCodeEnabled("pos.loyalty.settings", ALL_OFF)).toBe(false);
  });

  it("menu lain tidak tersentuh, termasuk kode kosong", () => {
    expect(isMenuCodeEnabled("pos.loyalty.payment-methods", ALL_OFF)).toBe(true);
    expect(isMenuCodeEnabled("pos.cashier", ALL_OFF)).toBe(true);
    expect(isMenuCodeEnabled(null, ALL_OFF)).toBe(true);
  });

  it("filterMenusByLoyaltyFeatures mempertahankan urutan & baris lain", () => {
    const menus = [
      { code: "pos.loyalty", name: "Member" },
      { code: "pos.loyalty.payment-methods", name: "Metode Bayar" },
      { code: "pos.loyalty.topup", name: "Topup" },
      { code: "pos.loyalty.settings", name: "ARK & XP" },
    ];
    expect(filterMenusByLoyaltyFeatures(menus, ALL_OFF).map((m) => m.name)).toEqual(["Member", "Metode Bayar"]);
    expect(filterMenusByLoyaltyFeatures(menus, ALL_ON)).toHaveLength(4);
  });
});

describe("isPathEnabled", () => {
  it("menutup halaman & sub-halaman fitur yang mati", () => {
    expect(isPathEnabled("/dashboard/pos/topup", ARK_OFF)).toBe(false);
    expect(isPathEnabled("/dashboard/pos/topup/ABC123?x=1", ARK_OFF)).toBe(false);
    expect(isPathEnabled("/dashboard/crm/rewards/", XP_OFF)).toBe(false);
    expect(isPathEnabled("/dashboard/crm/xp-rules", XP_OFF)).toBe(false);
  });

  it("tidak salah cocok prefix yang mirip", () => {
    expect(isPathEnabled("/dashboard/pos/topup-report", ARK_OFF)).toBe(true);
    expect(isPathEnabled("/dashboard/crm/rewards-archive", XP_OFF)).toBe(true);
  });

  it("halaman di luar aturan selalu boleh", () => {
    expect(isPathEnabled("/dashboard/pos", ALL_OFF)).toBe(true);
    expect(isPathEnabled("/dashboard/crm", ALL_OFF)).toBe(true);
  });
});

describe("isPaymentMethodEnabled", () => {
  it("hanya ARK Coin yang ikut saklar", () => {
    expect(isPaymentMethodEnabled("ark_coin", ARK_OFF)).toBe(false);
    expect(isPaymentMethodEnabled("ark_coin", ALL_ON)).toBe(true);
    expect(isPaymentMethodEnabled("cash", ALL_OFF)).toBe(true);
    expect(isPaymentMethodEnabled("qris", ALL_OFF)).toBe(true);
  });
});
