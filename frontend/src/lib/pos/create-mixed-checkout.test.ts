import { describe, expect, it } from "vitest";
import { allocateCheckoutCharges, shouldCreateCheckout } from "@/lib/pos/central-cashier";
import {
  CHECKOUT_CANCELLED_NOTE,
  MIXED_PROMO_UNSUPPORTED_MESSAGE,
  MISSING_PRODUCT_STALL_MESSAGE,
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
  MIXED_STALL_FORBIDDEN_MESSAGE,
  allocateCheckoutTender,
  assertCheckoutQrisReadyToComplete,
  canCancelUnpaidChildlessCheckout,
  groupItemsByStall,
  guardMixedCheckoutCart,
  isCancelledCheckout,
  mustConfirmStoredCheckoutQris,
  rejectMixedPromo,
  rejectUnsupportedMixedTender,
  resolveCheckoutBillTender,
  resolveCheckoutQrisAction,
  resolveCompleteCheckoutTender,
  resolveLineWarehouse,
  resolveOrderSoldFrom,
  resolveXenditPaidWebhookAction,
  settleMixedCheckoutTender,
  resolveCheckoutChildOrderStatus,
  shouldInsertCheckoutChildren,
  shouldReuseCheckoutQris,
  shouldSyncCustomerStatsOnFinalize,
  unpaidChildlessCheckoutCancelPatch,
  unpaidCheckoutScopeSql,
} from "@/lib/pos/create-mixed-checkout";

describe("guardMixedCheckoutCart", () => {
  it("rejects any product without warehouse_id", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", null],
      ]),
      canSellMixed: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MISSING_PRODUCT_STALL_MESSAGE);
    }
  });

  it("rejects mixed stalls without kasir pusat gate", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MIXED_STALL_FORBIDDEN_MESSAGE);
    }
  });

  it("creates checkout when mixed stalls and gate is open", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
    });
    expect(result).toEqual({
      ok: true,
      createCheckout: true,
      stallIds: ["w-a", "w-b"],
    });
  });

  it("keeps the single-stall order path", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-a"],
      ]),
      canSellMixed: true,
    });
    expect(result).toEqual({
      ok: true,
      createCheckout: false,
      stallIds: ["w-a"],
    });
  });

  it("rejects split bill on mixed checkout", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
      hasSplits: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MIXED_SPLIT_UNSUPPORTED_MESSAGE);
    }
  });

  it("rejects promo code on mixed checkout", () => {
    const withPromo = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
      promoCode: "HEMAT10",
    });
    expect(withPromo.ok).toBe(false);
    if (!withPromo.ok) {
      expect(withPromo.message).toBe(MIXED_PROMO_UNSUPPORTED_MESSAGE);
    }
  });

  it("never rejects on a transaction discount (the guard has no discount input)", () => {
    const withDiscount = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
    });
    expect(withDiscount.ok).toBe(true);
    if (withDiscount.ok) {
      expect(withDiscount.createCheckout).toBe(true);
      expect(withDiscount.stallIds).toEqual(["w-a", "w-b"]);
    }
  });
});

describe("rejectMixedPromo", () => {
  it("rejects only promo_code, not a manual discount", () => {
    expect(rejectMixedPromo({ promoCode: "X" })).toEqual({
      ok: false,
      message: MIXED_PROMO_UNSUPPORTED_MESSAGE,
    });
    expect(rejectMixedPromo({ promoCode: "  " })).toEqual({ ok: true });
    expect(rejectMixedPromo({})).toEqual({ ok: true });
  });
});

describe("manual discount allocation across stalls", () => {
  it("splits the discount pro-rata by subtotal", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 75000 },
        { warehouseId: "w-b", subtotal: 25000 },
      ],
      discount: 10000,
      tax: 0,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows.map((r) => r.discount)).toEqual([7500, 2500]);
    expect(rows.reduce((sum, r) => sum + r.discount, 0)).toBe(10000);
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(90000);
  });

  it("puts the rounding remainder on the largest stall so the total still ties out", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 20000 },
        { warehouseId: "w-b", subtotal: 10000 },
        { warehouseId: "w-c", subtotal: 10000 },
      ],
      discount: 1000,
      tax: 0,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows.reduce((sum, r) => sum + r.discount, 0)).toBe(1000);
    expect(rows[0].discount).toBeGreaterThanOrEqual(rows[1].discount);
  });
});

describe("groupItemsByStall", () => {
  it("groups cart lines by warehouse", () => {
    const grouped = groupItemsByStall(
      [
        { product_id: "p1", warehouse_id: "w-a" },
        { product_id: "p2", warehouse_id: "w-b" },
        { product_id: "p3", warehouse_id: "w-a" },
      ],
      (item) => item.warehouse_id
    );
    expect([...grouped.keys()]).toEqual(["w-a", "w-b"]);
    expect(grouped.get("w-a")?.map((item) => item.product_id)).toEqual(["p1", "p3"]);
    expect(grouped.get("w-b")?.map((item) => item.product_id)).toEqual(["p2"]);
  });
});

describe("resolveCheckoutChildOrderStatus", () => {
  it("marks pay-now mixed children completed when already paid", () => {
    expect(
      resolveCheckoutChildOrderStatus({
        paymentStatus: "paid",
        isOpenBill: false,
      })
    ).toBe("completed");
  });

  it("keeps open-bill children pending even after later kitchen work", () => {
    expect(
      resolveCheckoutChildOrderStatus({
        paymentStatus: "unpaid",
        isOpenBill: true,
      })
    ).toBe("pending");
    expect(
      resolveCheckoutChildOrderStatus({
        paymentStatus: "paid",
        isOpenBill: true,
      })
    ).toBe("pending");
  });
});

describe("shouldInsertCheckoutChildren", () => {
  it("skips children for unpaid QRIS prepare", () => {
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "qris",
        paymentStatus: "unpaid",
        amountPaid: 0,
        total: 25000,
      })
    ).toBe(false);
  });

  it("inserts children for cash/debit paid checkout", () => {
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "cash",
        paymentStatus: "paid",
        amountPaid: 25000,
        total: 25000,
      })
    ).toBe(true);
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "debit",
        amountPaid: 25000,
        total: 25000,
      })
    ).toBe(true);
  });
});

describe("resolveOrderSoldFrom", () => {
  it("marks kasir pusat sales as central even for one stall", () => {
    expect(resolveOrderSoldFrom({ isCentralCashier: true })).toBe("central");
    expect(resolveOrderSoldFrom({ isCentralCashier: false })).toBe("stall");
  });
});

describe("shouldReuseCheckoutQris", () => {
  it("reuses an existing Xendit id so a second QR is not created", () => {
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: null,
        xendit_external_id: "pos-chk-1",
      })
    ).toBe(true);
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: "qr_1",
        xendit_external_id: null,
      })
    ).toBe(true);
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: null,
        xendit_external_id: null,
      })
    ).toBe(false);
  });

  it("looks up by external_id instead of creating a second QR", () => {
    expect(
      resolveCheckoutQrisAction({
        xendit_qr_id: null,
        xendit_external_id: "pos-chk-1",
      })
    ).toBe("lookup_external_id");
    expect(
      resolveCheckoutQrisAction({
        xendit_qr_id: "qr_1",
        xendit_external_id: "pos-chk-1",
      })
    ).toBe("reuse_qr_id");
    expect(
      resolveCheckoutQrisAction({
        xendit_qr_id: null,
        xendit_external_id: null,
      })
    ).toBe("create");
  });
});

describe("rejectUnsupportedMixedTender", () => {
  it("rejects mixed NFC Tab and gift card until debit is wired", () => {
    expect(rejectUnsupportedMixedTender("nfc_tab")).toEqual({
      ok: false,
      message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
    });
    expect(rejectUnsupportedMixedTender("gift_card")).toEqual({
      ok: false,
      message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
    });
    expect(rejectUnsupportedMixedTender("cash")).toEqual({ ok: true });
    expect(rejectUnsupportedMixedTender("qris")).toEqual({ ok: true });
  });
});

describe("resolveLineWarehouse", () => {
  it("groups children by catalog warehouse, not client item.warehouse_id", () => {
    expect(
      resolveLineWarehouse(
        { product_id: "p1", warehouse_id: "client-spoof" },
        new Map([["p1", "catalog-w"]])
      )
    ).toBe("catalog-w");
  });
});

describe("allocateCheckoutTender", () => {
  it("allocates checkout amount_paid onto children, not zeros", () => {
    const paid = allocateCheckoutTender(27000, [18000, 9000]);
    expect(paid).toEqual([18000, 9000]);
    expect(paid.reduce((sum, value) => sum + value, 0)).toBe(27000);
    expect(paid.every((value) => value > 0)).toBe(true);
  });
});

describe("settleMixedCheckoutTender", () => {
  it("sets amount_paid to total_amount when QRIS settles", () => {
    expect(settleMixedCheckoutTender({ totalAmount: 27000 })).toEqual({
      amountPaid: 27000,
      changeAmount: 0,
    });
  });

  it("keeps cash overpay as change", () => {
    expect(
      settleMixedCheckoutTender({ totalAmount: 27000, amountPaid: 30000 })
    ).toEqual({
      amountPaid: 30000,
      changeAmount: 3000,
    });
  });
});

describe("resolveCheckoutBillTender", () => {
  it("requires payment_method and amount_paid for cash/card/QRIS", () => {
    expect(
      resolveCheckoutBillTender({ totalAmount: 27000 })
    ).toMatchObject({ ok: false, message: expect.stringMatching(/metode/i) });
    expect(
      resolveCheckoutBillTender({
        paymentMethod: "cash",
        totalAmount: 27000,
      })
    ).toMatchObject({ ok: false, message: expect.stringMatching(/nominal/i) });
    expect(
      resolveCheckoutBillTender({
        paymentMethod: "cash",
        amountPaid: 30000,
        totalAmount: 27000,
      })
    ).toEqual({
      ok: true,
      paymentMethod: "cash",
      amountPaid: 30000,
      changeAmount: 3000,
    });
    expect(
      resolveCheckoutBillTender({
        paymentMethod: "credit_card",
        amountPaid: 27000,
        totalAmount: 27000,
      })
    ).toEqual({
      ok: true,
      paymentMethod: "credit",
      amountPaid: 27000,
      changeAmount: 0,
    });
    expect(
      resolveCheckoutBillTender({
        paymentMethod: "qris",
        amountPaid: 27000,
        totalAmount: 27000,
      })
    ).toEqual({
      ok: true,
      paymentMethod: "qris",
      amountPaid: 27000,
      changeAmount: 0,
    });
  });

  it("rejects NFC, gift card, and ARK on checkout-bill pay", () => {
    expect(resolveCheckoutBillTender({
      paymentMethod: "nfc_tab",
      amountPaid: 27000,
      totalAmount: 27000,
    })).toEqual({
      ok: false,
      message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
    });
    expect(resolveCheckoutBillTender({
      paymentMethod: "gift_card",
      amountPaid: 27000,
      totalAmount: 27000,
    })).toEqual({
      ok: false,
      message: MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
    });
    const ark = resolveCheckoutBillTender({
      paymentMethod: "ark_coin",
      amountPaid: 27000,
      totalAmount: 27000,
    });
    expect(ark.ok).toBe(false);
    if (!ark.ok) {
      expect(ark.message).toMatch(/ARK/i);
    }
  });
});

describe("mustConfirmStoredCheckoutQris", () => {
  it("still requires Xendit confirm when children already exist", () => {
    expect(
      mustConfirmStoredCheckoutQris({
        paymentMethod: "qris",
        paymentAlreadyConfirmed: false,
        hasExistingChildren: true,
      })
    ).toBe(true);
    expect(
      mustConfirmStoredCheckoutQris({
        paymentMethod: "qris",
        paymentAlreadyConfirmed: true,
        hasExistingChildren: true,
      })
    ).toBe(false);
    expect(
      mustConfirmStoredCheckoutQris({
        paymentMethod: "cash",
        paymentAlreadyConfirmed: false,
        hasExistingChildren: true,
      })
    ).toBe(false);
  });
});

describe("unpaid childless checkout cancel", () => {
  it("allows cancel only for unpaid checkouts with no children", () => {
    expect(
      canCancelUnpaidChildlessCheckout({
        paymentStatus: "unpaid",
        childCount: 0,
      })
    ).toEqual({ ok: true });
    expect(
      canCancelUnpaidChildlessCheckout({
        paymentStatus: "unpaid",
        childCount: 2,
      }).ok
    ).toBe(false);
    expect(
      canCancelUnpaidChildlessCheckout({
        paymentStatus: "paid",
        childCount: 0,
      }).ok
    ).toBe(false);
  });

  it("unbinds the table and marks notes cancelled", () => {
    expect(unpaidChildlessCheckoutCancelPatch()).toEqual({
      table_id: null,
      notes: CHECKOUT_CANCELLED_NOTE,
    });
    expect(isCancelledCheckout({ notes: CHECKOUT_CANCELLED_NOTE })).toBe(true);
    expect(isCancelledCheckout({ notes: null })).toBe(false);
  });
});

describe("unpaidCheckoutScopeSql", () => {
  it("adds company_id and branch_id from session scope", () => {
    const scoped = unpaidCheckoutScopeSql({
      companyId: "co-1",
      branchId: "br-1",
      startParam: 2,
    });
    expect(scoped.sql).toContain("company_id = $2");
    expect(scoped.sql).toContain("branch_id = $3");
    expect(scoped.params).toEqual(["co-1", "br-1"]);
  });
});

describe("assertCheckoutQrisReadyToComplete", () => {
  it("rejects complete when no QR is stored", () => {
    const result = assertCheckoutQrisReadyToComplete({
      xenditQrId: null,
      xenditExternalId: null,
      paid: false,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects complete when stored QR is unpaid", () => {
    const result = assertCheckoutQrisReadyToComplete({
      xenditQrId: "qr_1",
      xenditExternalId: "pos-chk-1",
      paid: false,
    });
    expect(result.ok).toBe(false);
  });

  it("allows complete after isXenditQrPaid confirms the stored QR", () => {
    expect(
      assertCheckoutQrisReadyToComplete({
        xenditQrId: "qr_1",
        xenditExternalId: "pos-chk-1",
        paid: true,
      })
    ).toEqual({ ok: true });
  });
});

describe("guardMixedCheckoutCart uses shouldCreateCheckout", () => {
  it("matches shouldCreateCheckout for mixed vs single stall", () => {
    const mixed = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
    });
    const single = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-a"],
      ]),
      canSellMixed: true,
    });
    expect(mixed.ok && mixed.createCheckout).toBe(shouldCreateCheckout(["w-a", "w-b"]));
    expect(single.ok && single.createCheckout).toBe(shouldCreateCheckout(["w-a"]));
  });
});

describe("shouldSyncCustomerStatsOnFinalize", () => {
  it("syncs stats on first finalize only", () => {
    expect(shouldSyncCustomerStatsOnFinalize({ alreadyHadChildren: false })).toBe(true);
    expect(shouldSyncCustomerStatsOnFinalize({ alreadyHadChildren: true })).toBe(false);
  });
});

describe("resolveXenditPaidWebhookAction", () => {
  it("keeps the wallet topup path when a pending topup matches", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: "tx-1",
        checkoutId: "chk-1",
        childCount: 0,
      })
    ).toEqual({ type: "credit_topup" });
  });

  it("completes mixed checkout when external_id matches and children are missing", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: "chk-1",
        childCount: 0,
      })
    ).toEqual({ type: "complete_checkout", checkoutId: "chk-1" });
  });

  it("no-ops when checkout children already exist", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: "chk-1",
        childCount: 2,
      })
    ).toEqual({ type: "noop_checkout", checkoutId: "chk-1" });
  });

  it("ignores paid webhooks that match neither topup nor checkout", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: null,
        childCount: 0,
      })
    ).toEqual({ type: "ignore" });
  });

  it("no-ops on webhook retry when a single child order already exists", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: "chk-1",
        childCount: 1,
      })
    ).toEqual({ type: "noop_checkout", checkoutId: "chk-1" });
  });

  // Bug #2 (insiden 2026-08-25): QRIS diikat ke satu order open bill —
  // webhook harus mengenali & menyelesaikannya, bukan diabaikan.
  it("completes a standalone order when it matches and no checkout matched", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: null,
        childCount: 0,
        orderId: "ord-1",
      })
    ).toEqual({ type: "complete_order", orderId: "ord-1" });
  });

  it("prefers checkout over a standalone order when both are somehow present", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: "chk-1",
        childCount: 0,
        orderId: "ord-1",
      })
    ).toEqual({ type: "complete_checkout", checkoutId: "chk-1" });
  });

  it("prefers topup over a standalone order when both are somehow present", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: "tx-1",
        checkoutId: null,
        childCount: 0,
        orderId: "ord-1",
      })
    ).toEqual({ type: "credit_topup" });
  });

  it("still ignores when neither topup, checkout, nor order matched", () => {
    expect(
      resolveXenditPaidWebhookAction({
        topupId: null,
        checkoutId: null,
        childCount: 0,
        orderId: null,
      })
    ).toEqual({ type: "ignore" });
  });
});

describe("resolveCompleteCheckoutTender", () => {
  it("lets completeMixedCheckout(checkoutId) use stored QRIS tender", () => {
    expect(
      resolveCompleteCheckoutTender({
        storedPaymentMethod: "qris",
        totalAmount: 45000,
      })
    ).toEqual({
      paymentMethod: "qris",
      amountPaid: 45000,
    });
  });

  it("prefers an explicit cashier tender over stored checkout values", () => {
    expect(
      resolveCompleteCheckoutTender({
        tender: { paymentMethod: "cash", amountPaid: 50000 },
        storedPaymentMethod: "qris",
        totalAmount: 45000,
      })
    ).toEqual({
      paymentMethod: "cash",
      amountPaid: 50000,
    });
  });
});

describe("allocateCheckoutCharges for mixed children", () => {
  it("keeps stall subtotals and allocated totals summing to checkout", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 20000 },
        { warehouseId: "w-b", subtotal: 10000 },
      ],
      discount: 3000,
      tax: 2700,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].total + rows[1].total).toBe(20000 + 10000 - 3000 + 2700);
    expect(rows[0].warehouseId).toBe("w-a");
  });
});
