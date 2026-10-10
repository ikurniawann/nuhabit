import { describe, expect, it } from "vitest";
import { addCartLine } from "./storefront-cart";
import {
  arkCoinAvailable,
  buildCheckoutPayload,
  checkoutDraftError,
  checkoutTotals,
  freeShippingProgress,
  freeShippingRemaining,
  promoLines,
} from "./storefront-checkout";
import type { PickupBranch, ShopMember } from "./types";

const tee = { id: "p1", name: "Tee", price: 100_000 };
const sizeL = { id: "s1", name: "L", price: 120_000 };
const lines = addCartLine([], tee, sizeL, 2);
const promo = { code: "WELCOME", discountAmount: 40_000, label: "Welcome 40k off" };
const branches: PickupBranch[] = [{ id: "b1", name: "Dago", address: "Jl. Dago 1", city: "Bandung", phone: "0811" }];

describe("free shipping", () => {
  it("counts down to the threshold and unlocks at it", () => {
    expect(freeShippingRemaining(240_000, null)).toBeNull();
    expect(freeShippingRemaining(240_000, 0)).toBeNull();
    expect(freeShippingRemaining(240_000, 300_000)).toBe(60_000);
    expect(freeShippingRemaining(300_000, 300_000)).toBe(0);
    expect(freeShippingProgress(240_000, 300_000)).toEqual({ text: "Rp60.000 away from free shipping", ratio: 0.8, unlocked: false });
    expect(freeShippingProgress(350_000, 300_000)).toEqual({ text: "You've unlocked free shipping", ratio: 1, unlocked: true });
    expect(freeShippingProgress(350_000, null)).toBeNull();
  });
});

describe("checkoutTotals", () => {
  it("applies the discount and the courier rate for shipping", () => {
    expect(checkoutTotals({ lines, promo, method: "ship", rateCost: 15_000, freeShippingThreshold: null })).toEqual({
      subtotal: 240_000, discount: 40_000, shipping: 15_000, freeShipping: false, total: 215_000,
    });
  });

  it("pickup and an unlocked threshold ship free; the discount never exceeds the subtotal", () => {
    expect(checkoutTotals({ lines, promo: null, method: "pickup", rateCost: 15_000, freeShippingThreshold: null })).toMatchObject({ shipping: 0, total: 240_000 });
    expect(checkoutTotals({ lines, promo: null, method: "ship", rateCost: 15_000, freeShippingThreshold: 200_000 })).toMatchObject({ shipping: 0, freeShipping: true, total: 240_000 });
    expect(checkoutTotals({ lines, promo: { ...promo, discountAmount: 999_999 }, method: "pickup", rateCost: null, freeShippingThreshold: null })).toMatchObject({ discount: 240_000, total: 0 });
  });
});

describe("arkCoinAvailable", () => {
  const member: ShopMember = { name: "Budi", phone: "0812", email: null, arkBalance: 250_000, lastAddress: null };
  it("needs a member whose balance covers the total", () => {
    expect(arkCoinAvailable(null, 100_000)).toBe(false);
    expect(arkCoinAvailable(member, 250_000)).toBe(true);
    expect(arkCoinAvailable(member, 250_001)).toBe(false);
    expect(arkCoinAvailable(member, 0)).toBe(false);
  });
});

describe("checkoutDraftError", () => {
  const ship = { name: "Budi", phone: "0812-3456-789", email: "", method: "ship" as const, branchId: null, address: "Jl. Melati No. 10", hasArea: true, hasRate: true };

  it("validates contact first, then the delivery method's own fields", () => {
    expect(checkoutDraftError(ship, branches)).toBeNull();
    expect(checkoutDraftError({ ...ship, name: " B " }, branches)).toBe("Your name is required");
    expect(checkoutDraftError({ ...ship, phone: "0812-34" }, branches)).toBe("Enter a valid WhatsApp number");
    expect(checkoutDraftError({ ...ship, email: "nope" }, branches)).toBe("Enter a valid email address or leave it blank");
    expect(checkoutDraftError({ ...ship, hasArea: false }, branches)).toBe("Choose a destination area first");
    expect(checkoutDraftError({ ...ship, address: "short" }, branches)).toBe("Full address must be at least 10 characters");
    expect(checkoutDraftError({ ...ship, hasRate: false }, branches)).toBe("Choose a courier first");
  });

  it("pickup ignores the address and needs a known branch", () => {
    const pickup = { ...ship, method: "pickup" as const, address: "", hasArea: false, hasRate: false };
    expect(checkoutDraftError({ ...pickup, branchId: "b1" }, branches)).toBeNull();
    expect(checkoutDraftError({ ...pickup, branchId: null }, branches)).toBe("Choose a branch for pickup");
    expect(checkoutDraftError({ ...pickup, branchId: "gone" }, branches)).toBe("Choose a branch for pickup");
  });
});

describe("buildCheckoutPayload", () => {
  const base = {
    lines,
    customer: { name: " Budi ", phone: "0812 ", email: " " },
    area: { id: "a1", label: "Coblong, Bandung", postalCode: "40132" },
    address: "Jl. Dago 1 ",
    courier: { code: "jne", serviceCode: "reg" },
    promo,
    note: " Gift wrap ",
  };

  it("ship: destination, courier, promo code and Xendit", () => {
    expect(buildCheckoutPayload({ ...base, method: "ship", branchId: null, payment: "xendit" })).toEqual({
      items: [{ product_id: "p1", sku_id: "s1", quantity: 2 }],
      customer: { name: "Budi", phone: "0812", email: null },
      delivery: { method: "ship" },
      destination: { area_id: "a1", label: "Coblong, Bandung", postal_code: "40132", address: "Jl. Dago 1" },
      courier: { code: "jne", service_code: "reg" },
      promoCode: "WELCOME",
      payment: { method: "xendit" },
      notes: "Gift wrap",
    });
  });

  it("pickup: branch only, no destination or courier, ARK Coin", () => {
    const payload = buildCheckoutPayload({ ...base, method: "pickup", branchId: "b1", promo: null, payment: "arkcoin", note: "" });
    expect(payload).toEqual({
      items: [{ product_id: "p1", sku_id: "s1", quantity: 2 }],
      customer: { name: "Budi", phone: "0812", email: null },
      delivery: { method: "pickup", branchId: "b1" },
      payment: { method: "arkcoin" },
      notes: null,
    });
  });

  it("promo preview lines carry ids and quantities only", () => {
    expect(promoLines(lines)).toEqual([{ productId: "p1", skuId: "s1", quantity: 2 }]);
  });
});
