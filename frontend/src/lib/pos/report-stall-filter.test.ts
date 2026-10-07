import { describe, expect, it } from "vitest";
import { shouldExpandReportStallsToBranch } from "./report-stall-filter";

describe("shouldExpandReportStallsToBranch", () => {
  it("keeps assigned-only stalls for a regular stall cashier", () => {
    expect(
      shouldExpandReportStallsToBranch({
        isUnscoped: false,
        canCentralCheckout: false,
      })
    ).toBe(false);
  });

  it("expands to all branch stalls for kasir pusat", () => {
    expect(
      shouldExpandReportStallsToBranch({
        isUnscoped: false,
        canCentralCheckout: true,
      })
    ).toBe(true);
  });

  it("expands for unscoped / super admin", () => {
    expect(
      shouldExpandReportStallsToBranch({
        isUnscoped: true,
        canCentralCheckout: false,
      })
    ).toBe(true);
  });
});
