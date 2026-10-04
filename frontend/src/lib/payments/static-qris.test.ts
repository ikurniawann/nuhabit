import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/app-settings", () => ({
  getSettings: vi.fn(),
  SETTING_KEYS: { STATIC_QRIS_ENABLED: "static_qris_enabled", STATIC_QRIS_IMAGE_URL: "static_qris_image_url" },
}));

import { isPaymentProofPathFor, parseStaticQris } from "./static-qris";

const ORDER = "11111111-1111-4111-8111-111111111111";

describe("parseStaticQris", () => {
  it("tersedia hanya bila aktif DAN gambar ada", () => {
    expect(parseStaticQris("true", "/api/files/payment-qris/a.png")).toEqual({
      enabled: true,
      imageUrl: "/api/files/payment-qris/a.png",
      available: true,
    });
    expect(parseStaticQris("true", null).available).toBe(false);
    expect(parseStaticQris("true", "   ").imageUrl).toBeNull();
    expect(parseStaticQris("false", "/api/files/payment-qris/a.png").available).toBe(false);
    expect(parseStaticQris(null, null)).toEqual({ enabled: false, imageUrl: null, available: false });
  });
});

describe("isPaymentProofPathFor", () => {
  it("hanya path di folder order itu sendiri", () => {
    expect(isPaymentProofPathFor(ORDER, `payment-proofs/${ORDER}/1-a.jpg`)).toBe(true);
    expect(isPaymentProofPathFor(ORDER, "payment-proofs/lain/1-a.jpg")).toBe(false);
    expect(isPaymentProofPathFor(ORDER, `payment-proofs/${ORDER}/../../psikotes/x.png`)).toBe(false);
    expect(isPaymentProofPathFor(ORDER, "psikotes/x.png")).toBe(false);
    expect(isPaymentProofPathFor(ORDER, null)).toBe(false);
  });
});
