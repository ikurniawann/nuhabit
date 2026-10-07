import { describe, expect, it } from "vitest";
import { POLL_INTERVAL_MS, pollInterval, purchaseOutcome, type PurchaseView } from "./purchase-status";

const view = (status: string): PurchaseView => ({
  id: "p",
  status,
  package_name: "4-Week Pass",
  kind: "pass",
  credits: 0,
  validity_days: 28,
  total_idr: 1200000,
  invoice_url: null,
  expires_at: null,
});

describe("purchaseOutcome", () => {
  it("maps the portal status to the four outcomes", () => {
    expect(purchaseOutcome("pending")).toBe("pending");
    expect(purchaseOutcome("paid")).toBe("paid");
    expect(purchaseOutcome("expired")).toBe("expired");
    expect(purchaseOutcome("failed")).toBe("failed");
    expect(purchaseOutcome("refunded")).toBe("failed");
  });
});

describe("pollInterval", () => {
  it("polls while pending and stops on every final state", () => {
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval(view("pending"))).toBe(POLL_INTERVAL_MS);
    expect(pollInterval(view("paid"))).toBe(false);
    expect(pollInterval(view("expired"))).toBe(false);
    expect(pollInterval(view("failed"))).toBe(false);
  });
});
