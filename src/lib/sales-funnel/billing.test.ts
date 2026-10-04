import { describe, expect, it } from "vitest";
import { derivePaymentStatus, resolveReferenceTotal, roundCents } from "./billing";

describe("derivePaymentStatus", () => {
  it("lunas, sebagian, belum", () => {
    expect(derivePaymentStatus(1000, 1000)).toBe("lunas");
    expect(derivePaymentStatus(1200, 1000)).toBe("lunas");
    expect(derivePaymentStatus(1, 1000)).toBe("sebagian");
    expect(derivePaymentStatus(0, 1000)).toBe("belum");
    expect(derivePaymentStatus(0, 0)).toBe("belum");
  });
});

describe("resolveReferenceTotal", () => {
  const deal = { value_final: "9000000", value_estimate: "7000000" };
  it("quotation diterima menang atas nilai final deal", () => {
    expect(resolveReferenceTotal({ status: "diterima", total: "8500000" }, deal)).toBe(8_500_000);
  });
  it("nilai final deal menang atas quotation yang belum diterima", () => {
    expect(resolveReferenceTotal({ status: "terkirim", total: "8500000" }, deal)).toBe(9_000_000);
  });
  it("tanpa nilai final: quotation terbaru, lalu estimasi", () => {
    const open = { value_final: null, value_estimate: "7000000" };
    expect(resolveReferenceTotal({ status: "draft", total: "8500000" }, open)).toBe(8_500_000);
    expect(resolveReferenceTotal(null, open)).toBe(7_000_000);
    expect(resolveReferenceTotal(null, null)).toBe(0);
  });
});

describe("roundCents", () => {
  it("membulatkan ke 2 desimal", () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(1234.565)).toBe(1234.57);
  });
});
