import { describe, expect, it } from "vitest";
import { isPublicAuthPath } from "./middleware";

describe("isPublicAuthPath", () => {
  it("allows Xendit POS webhook without a session", () => {
    expect(isPublicAuthPath("/api/payments/xendit/webhook")).toBe(true);
  });

  it("allows static product photos & QRIS logos for the public self-order page (EPIC-048)", () => {
    expect(isPublicAuthPath("/products/kopi-susu.png")).toBe(true);
    expect(isPublicAuthPath("/site/sample/training-session.webp")).toBe(true);
    expect(isPublicAuthPath("/qris/qris-logo.svg")).toBe(true);
    expect(isPublicAuthPath("/table-order/TBL-501-SEED")).toBe(true);
    expect(isPublicAuthPath("/api/table-order/products")).toBe(true);
  });

  it("allows the GoBiz webhook receiver (token in path) but not its settings API", () => {
    expect(isPublicAuthPath("/api/integrations/gobiz/webhook/abc123")).toBe(true);
    expect(isPublicAuthPath("/api/public/gofood-image/abc.jpg")).toBe(true);
    expect(isPublicAuthPath("/api/settings/gobiz")).toBe(false);
    expect(isPublicAuthPath("/api/pos/gofood/orders")).toBe(false);
  });

  it("does not open dashboard product pages by accident", () => {
    expect(isPublicAuthPath("/dashboard/pos/products")).toBe(false);
    expect(isPublicAuthPath("/api/pos/products")).toBe(false);
  });

  it("still protects POS APIs", () => {
    expect(isPublicAuthPath("/api/pos/qris")).toBe(false);
    expect(isPublicAuthPath("/api/pos/orders")).toBe(false);
  });
});
