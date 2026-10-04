import { describe, expect, it, vi } from "vitest";
import { routePosNfcCard } from "./route-card-scan";

describe("routePosNfcCard", () => {
  it("redirects to topup when payment is idle", () => {
    const push = vi.fn();
    expect(
      routePosNfcCard({
        card: "04AABBCC",
        pathname: "/dashboard/pos/restaurant",
        paymentNfcActive: false,
        push,
      })
    ).toBe("redirected");
    expect(push).toHaveBeenCalledWith("/dashboard/pos/topup?card=04AABBCC");
  });

  it("dispatches for payment flow instead of redirect", () => {
    const push = vi.fn();
    expect(
      routePosNfcCard({
        card: "04AABBCC",
        pathname: "/dashboard/pos/cashier-new",
        paymentNfcActive: true,
        push,
      })
    ).toBe("dispatched");
    expect(push).not.toHaveBeenCalled();
  });

  it("sends a member QR to the cashier even when payment is idle", () => {
    const push = vi.fn();
    expect(
      routePosNfcCard({
        card: "bcdqr_abcdefghijklmnop",
        pathname: "/dashboard/pos/restaurant",
        paymentNfcActive: false,
        push,
      })
    ).toBe("dispatched");
    expect(push).not.toHaveBeenCalled();
  });
});
