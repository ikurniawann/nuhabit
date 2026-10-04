import { describe, expect, it } from "vitest";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import { DEFAULT_BILLING_CHARGES, calculateBillCharges, resolveEnabledOptionalCodes } from "@/lib/pos/billing-settings";
import {
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
} from "@/lib/pos/central-cashier";
import {
  cashChange,
  cfdCartState,
  computeCashierBill,
  discountReasonLabel,
  focReceiptFields,
  offlineOrderItems,
  offlinePaymentMethod,
  openBillItems,
  paymentBlocker,
  receiptDiscountLines,
} from "./checkout";

const item = (overrides: Partial<PosCartItem> = {}): PosCartItem => ({
  id: "p1",
  productId: "p1",
  name: "Kopi",
  price: 20_000,
  quantity: 2,
  ...overrides,
});

const billInput = (overrides: Partial<Parameters<typeof computeCashierBill>[0]> = {}) => ({
  items: [item()],
  offerRules: [],
  promo: null,
  membershipPct: 0,
  manualType: null,
  manualValue: null,
  charges: [],
  includeTax: false,
  includeService: false,
  arkBalance: null,
  arkToUse: 0,
  ...overrides,
});

describe("computeCashierBill", () => {
  it("stacks line, membership, promo and manual discounts in order", () => {
    const bill = computeCashierBill(
      billInput({
        items: [item({ discount_type: "fixed", discount_value: 4_000 })],
        membershipPct: 10,
        promo: { code: "HEMAT", discount: 1_000 },
        manualType: "fixed",
        manualValue: 500,
      })
    );
    // 40.000 - 4.000 item = 36.000; member 10% = 3.600; promo 1.000; manual 500
    expect(bill.stack.gross_subtotal).toBe(40_000);
    expect(bill.stack.line_discount_total).toBe(4_000);
    expect(bill.stack.membership_amount).toBe(3_600);
    expect(bill.stack.promo_amount).toBe(1_000);
    expect(bill.stack.manual_amount).toBe(500);
    expect(bill.total).toBe(30_900);
    expect(bill.manualDiscountBasis).toBe(36_000 - 3_600 - 1_000);
    expect(bill.discount).toMatchObject({ membershipPct: 10, promoCode: "HEMAT", offerNames: [] });
  });

  it("applies billing charges exactly like calculateBillCharges", () => {
    const bill = computeCashierBill(
      billInput({ charges: DEFAULT_BILLING_CHARGES, includeTax: true, includeService: true })
    );
    const expected = calculateBillCharges({
      subtotalAfterDiscount: 40_000,
      charges: DEFAULT_BILLING_CHARGES,
      enabledOptionalCodes: resolveEnabledOptionalCodes(DEFAULT_BILLING_CHARGES, true, true),
    });
    expect(bill.total).toBe(expected.total);
    expect(bill.billCharges).toEqual(expected);
    expect(bill.otherChargeLines.every((line) => !["tax", "service"].includes(line.code))).toBe(true);
  });

  it("caps ARK to the member balance and the total", () => {
    expect(computeCashierBill(billInput({ arkBalance: 15_000, arkToUse: 50_000 }))).toMatchObject({
      maxArkUsable: 15_000,
      arkToUseCapped: 15_000,
      totalAfterArk: 25_000,
    });
    expect(computeCashierBill(billInput({ arkBalance: 90_000, arkToUse: 90_000 }))).toMatchObject({
      maxArkUsable: 40_000,
      totalAfterArk: 0,
    });
    expect(computeCashierBill(billInput({ arkBalance: null, arkToUse: 10_000 })).arkToUseCapped).toBe(0);
  });

  it("skips offer evaluation for an empty cart or no rules", () => {
    expect(computeCashierBill(billInput({ items: [] })).offerEval).toEqual({ offer_discount: 0, applied: [] });
    expect(computeCashierBill(billInput({ offerRules: [null, undefined] })).offerEval.offer_discount).toBe(0);
  });
});

describe("paymentBlocker", () => {
  const base = {
    method: "cash",
    foc: false,
    hasCustomer: true,
    supervisorPin: "",
    isOnline: true,
    mixedCart: false,
    hasPromo: false,
    itemDiscountTotal: 0,
    payingCheckoutBill: false,
  };

  it("allows a plain payment", () => {
    expect(paymentBlocker(base)).toBeNull();
  });

  it("FOC needs a customer, a PIN, and a connection, in that order", () => {
    expect(paymentBlocker({ ...base, foc: true, hasCustomer: false })).toBe(
      "Metode FOC membutuhkan customer/member — pilih customer dulu"
    );
    expect(paymentBlocker({ ...base, foc: true })).toBe("Metode FOC membutuhkan PIN supervisor");
    expect(paymentBlocker({ ...base, foc: true, supervisorPin: "1234", isOnline: false })).toBe(
      "Metode FOC membutuhkan koneksi — PIN supervisor diverifikasi server"
    );
    expect(paymentBlocker({ ...base, foc: true, supervisorPin: "1234" })).toBeNull();
  });

  it("multi-stall carts reject NFC/gift, promo, then line discounts", () => {
    const mixed = { ...base, mixedCart: true };
    expect(paymentBlocker({ ...mixed, method: "gift_card", hasPromo: true })).toBe(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE);
    expect(paymentBlocker({ ...mixed, hasPromo: true, itemDiscountTotal: 5 })).toBe(MIXED_PROMO_UNSUPPORTED_MESSAGE);
    expect(paymentBlocker({ ...mixed, itemDiscountTotal: 5 })).toBe(MIXED_LINE_DISCOUNT_UNSUPPORTED_MESSAGE);
  });

  it("checkout bills reject ARK with its own message and NFC/gift with the shared one", () => {
    const bill = { ...base, payingCheckoutBill: true };
    expect(paymentBlocker({ ...bill, method: "ark_coin" })).toBe(MIXED_ARK_UNSUPPORTED_MESSAGE);
    expect(paymentBlocker({ ...bill, method: "nfc_tab" })).toBe(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE);
    expect(paymentBlocker({ ...bill, method: "qris" })).toBeNull();
  });

  it("offline multi-stall checkout needs a prepared checkout", () => {
    const offline = { ...base, mixedCart: true, isOnline: false };
    expect(paymentBlocker(offline)).toBe("Checkout multi-stall membutuhkan koneksi");
    expect(paymentBlocker({ ...offline, preparedCheckoutId: "c1" })).toBeNull();
  });
});

describe("discount labels", () => {
  const stack = computeCashierBill(
    billInput({
      items: [item({ discount_type: "percent", discount_value: 10 })],
      membershipPct: 5,
      promo: { code: "HEMAT", discount: 1_000 },
      manualType: "percent",
      manualValue: 2,
    })
  ).stack;
  const ctx = {
    stack,
    offerNames: ["Bundle Pagi"],
    membershipPct: 5,
    promoCode: "HEMAT",
    manualType: "percent" as const,
    manualValue: 2,
  };

  it("builds the open bill discount reason", () => {
    expect(discountReasonLabel(ctx)).toBe(
      "ITEM line discounts; OFFER Bundle Pagi; MEMBER 5%; PROMO HEMAT; MANUAL 2%"
    );
    expect(discountReasonLabel({ ...ctx, manualType: "fixed", manualValue: 1500.7 })).toContain("MANUAL Rp 1500");
    expect(
      discountReasonLabel({
        ...ctx,
        stack: computeCashierBill(billInput()).stack,
        offerNames: [],
        membershipPct: 0,
        promoCode: null,
        manualType: null,
      })
    ).toBeUndefined();
  });

  it("lists receipt discount lines per kind", () => {
    expect(receiptDiscountLines(ctx).map((line) => line.label)).toEqual([
      "Diskon Item",
      "Diskon Member (5%)",
      "Promo HEMAT",
      "Diskon Manual (2%)",
    ]);
  });
});

describe("payload items", () => {
  const custom = item({ price: 25_000, variantName: "Large", variantPriceAdj: 3_000, modifierNames: ["Oat"], modifierPriceAdj: 2_000, notes: "hot", station: "bar" });

  it("open bill items split base price from adjustments", () => {
    expect(openBillItems([custom])[0]).toMatchObject({
      product_sku: "p1",
      variants: [{ name: "Large", group: "Size", price: 3_000 }],
      modifiers: [{ name: "Oat", group: "Option-0" }],
      unit_price: 20_000,
      variant_price_adjustment: 3_000,
      modifier_price_adjustment: 2_000,
      subtotal: 50_000,
      total_amount: 50_000,
      discount_amount: 0,
      kitchen_notes: "hot",
    });
  });

  it("offline items use the final unit price and the SKU code when present", () => {
    expect(offlineOrderItems([{ ...custom, skuCode: "KOP-L" }])[0]).toEqual({
      product_id: "p1",
      sku_id: undefined,
      product_name: "Kopi",
      product_sku: "KOP-L",
      quantity: 2,
      unit_price: 25_000,
      subtotal: 50_000,
      total_amount: 50_000,
    });
  });

  it("maps offline payment methods", () => {
    expect(offlinePaymentMethod("credit_card")).toBe("credit");
    expect(offlinePaymentMethod("qris")).toBe("qris");
    expect(offlinePaymentMethod("ark_coin")).toBe("ark_coin");
    expect(offlinePaymentMethod("transfer_bca")).toBe("cash");
  });
});

describe("receipt helpers", () => {
  it("computes cash change only for cash", () => {
    expect(cashChange("cash", "50000", 42_500)).toBe(7_500);
    expect(cashChange("cash", "", 10_000)).toBe(-10_000);
    expect(cashChange("qris", "50000", 42_500)).toBe(0);
  });

  it("FOC receipts show zero total and the full bill as discount", () => {
    expect(focReceiptFields(42_500, undefined)).toEqual({
      total: 0,
      change: 0,
      discountAmount: 42_500,
      compType: "foc_comp",
      compApprovedName: null,
    });
  });
});

describe("cfdCartState", () => {
  const base = {
    items: [] as PosCartItem[],
    subtotal: 0,
    discount: 0,
    tax: 0,
    arkUsed: 0,
    total: 0,
    payment: null,
    memberName: null,
    now: 123,
  };

  it("is idle with an empty cart and no payment", () => {
    expect(cfdCartState(base).status).toBe("idle");
  });

  it("shows the cart, then the payment step", () => {
    const cart = cfdCartState({ ...base, items: [item({ price: 3333.3, quantity: 3 })], total: 10_000 });
    expect(cart.status).toBe("cart");
    expect(cart.items[0]).toEqual({ name: "Kopi", qty: 3, unit_price: 3333.3, line_total: 10_000 });
    expect(cart.updated_at).toBe(123);
    const paying = cfdCartState({ ...base, payment: { method: "qris", amount: 10_000 } });
    expect(paying.status).toBe("payment");
  });
});
