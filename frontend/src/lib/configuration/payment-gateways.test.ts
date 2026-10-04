import { describe, expect, it } from "vitest";
import {
  maskSecret,
  shouldKeepExistingSecret,
  toPaymentGatewayPublic,
  type PaymentGatewayRow,
} from "./payment-gateways";

describe("maskSecret", () => {
  it("masks long secrets with asterisks", () => {
    expect(maskSecret("xnd_development_abcdef")).toBe("xnd_********cdef");
  });

  it("returns null for empty", () => {
    expect(maskSecret("")).toBeNull();
    expect(maskSecret(null)).toBeNull();
  });
});

describe("shouldKeepExistingSecret", () => {
  it("keeps on empty or masked", () => {
    expect(shouldKeepExistingSecret("")).toBe(true);
    expect(shouldKeepExistingSecret("xnd_********cdef")).toBe(true);
    expect(shouldKeepExistingSecret("xnd_development_new")).toBe(false);
  });
});

describe("toPaymentGatewayPublic", () => {
  it("maps coming soon metadata", () => {
    const row: PaymentGatewayRow = {
      id: "1",
      provider: "midtrans",
      display_name: "Midtrans",
      is_active: false,
      environment: "sandbox",
      secret_key: null,
      public_key: null,
      webhook_secret: null,
      callback_url: null,
      metadata: { coming_soon: true },
      updated_at: null,
      created_at: null,
    };
    expect(toPaymentGatewayPublic(row).coming_soon).toBe(true);
  });
});
