import { describe, expect, it } from "vitest";
import { buildTopupCardPath, shouldRedirectNfcScan } from "./resolve-topup-path";

describe("buildTopupCardPath", () => {
  it("encodes the card query param", () => {
    expect(buildTopupCardPath("ABC 123")).toBe(
      "/dashboard/pos/topup?card=ABC%20123"
    );
  });
});

describe("shouldRedirectNfcScan", () => {
  it("redirects when payment is idle and path is POS", () => {
    expect(
      shouldRedirectNfcScan({
        pathname: "/dashboard/pos/restaurant",
        paymentNfcActive: false,
      })
    ).toBe(true);
  });

  it("does not redirect when payment NFC is active", () => {
    expect(
      shouldRedirectNfcScan({
        pathname: "/dashboard/pos/cashier-new",
        paymentNfcActive: true,
      })
    ).toBe(false);
  });

  it("does not redirect outside POS routes", () => {
    expect(
      shouldRedirectNfcScan({
        pathname: "/dashboard/purchasing",
        paymentNfcActive: false,
      })
    ).toBe(false);
  });

  it("still allows apply-on-topup (no external redirect needed)", () => {
    expect(
      shouldRedirectNfcScan({
        pathname: "/dashboard/pos/topup",
        paymentNfcActive: false,
      })
    ).toBe(true);
  });
});
