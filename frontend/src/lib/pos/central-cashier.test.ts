import { describe, expect, it } from "vitest";
import {
  MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
  allocateCheckoutCharges,
  assertAllModeSellStallAssigned,
  buildPosQrisCreateBody,
  canAddItemToSingleStallCart,
  canSellMixedStall,
  isCheckoutBillUnsupportedTender,
  isMixedUnsupportedTender,
  MIXED_ARK_UNSUPPORTED_MESSAGE,
  buildCheckoutBillPayBody,
  mapPaidSaleToReceiptIds,
  mayConfirmMixedQris,
  shouldPrepareOrderForQris,
  shouldStopQrisAutoRetry,
  shouldWaitForQrisConfirm,
  mixedQrisCheckoutIdForAmount,
  resolveAddCatalogItem,
  shouldSkipQrisPrepare,
  resolveCheckoutApi,
  resolveSingleStallSellFromAllMode,
  shouldConfirmClearCart,
  shouldCreateCheckout,
  shouldDisableSplitBill,
  shouldDisableMixedPromo,
  uniqueStallIds,
} from "./central-cashier";

describe("canSellMixedStall", () => {
  it("requires menu + user flag + mode all", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "all",
      })
    ).toBe(true);
  });

  it("rejects switch-only or single stall mode", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: false,
        activeMode: "all",
      })
    ).toBe(false);
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "stall",
      })
    ).toBe(false);
  });
});

describe("checkout decision", () => {
  it("creates checkout only for 2+ stalls", () => {
    expect(uniqueStallIds(["w-a", "w-a", "w-b"])).toEqual(["w-a", "w-b"]);
    expect(shouldCreateCheckout(["w-a"])).toBe(false);
    expect(shouldCreateCheckout(["w-a", "w-b"])).toBe(true);
  });
});

describe("resolveAddCatalogItem", () => {
  it("skips the single-stall guard when kasir pusat may sell mixed", () => {
    expect(
      resolveAddCatalogItem({
        canSellMixed: true,
        existingStallIds: ["w-a"],
        incomingWarehouseId: "w-b",
        centralAllMode: true,
      })
    ).toEqual({ ok: true });
  });

  it("blocks add-to-cart while paying a hydrated checkout bill", () => {
    const result = resolveAddCatalogItem({
      canSellMixed: true,
      existingStallIds: ["w-a"],
      incomingWarehouseId: "w-b",
      centralAllMode: true,
      payingExistingCheckout: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/tagihan/i);
    }
  });

  it("keeps the single-stall guard for regular cashiers", () => {
    const result = resolveAddCatalogItem({
      canSellMixed: false,
      existingStallIds: ["w-a"],
      incomingWarehouseId: "w-b",
      centralAllMode: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("satu stall");
    }
  });
});

describe("mixed cart payment UI", () => {
  it("routes 2+ stalls to checkout API and blocks split / NFC / gift", () => {
    expect(resolveCheckoutApi(["w-a", "w-b"])).toBe("checkout");
    expect(resolveCheckoutApi(["w-a"])).toBe("order");
    expect(shouldDisableSplitBill(["w-a", "w-b"])).toBe(true);
    expect(shouldDisableSplitBill(["w-a"])).toBe(false);
    expect(shouldDisableMixedPromo(["w-a", "w-b"])).toBe(true);
    expect(shouldDisableMixedPromo(["w-a"])).toBe(false);
    expect(isMixedUnsupportedTender("nfc_tab")).toBe(true);
    expect(isMixedUnsupportedTender("gift_card")).toBe(true);
    expect(isMixedUnsupportedTender("cash")).toBe(false);
    expect(isCheckoutBillUnsupportedTender("ark_coin")).toBe(true);
    expect(isCheckoutBillUnsupportedTender("nfc_tab")).toBe(true);
    expect(isCheckoutBillUnsupportedTender("cash")).toBe(false);
    expect(MIXED_ARK_UNSUPPORTED_MESSAGE).toMatch(/ARK/i);
    expect(
      buildCheckoutBillPayBody({
        method: "credit_card",
        total: 27000,
      })
    ).toEqual({ payment_method: "credit", amount_paid: 27000 });
    expect(
      buildCheckoutBillPayBody({
        method: "cash",
        cashReceived: "30000",
        total: 27000,
      })
    ).toEqual({ payment_method: "cash", amount_paid: 30000 });
    expect(MIXED_SPLIT_UNSUPPORTED_MESSAGE).toBe(
      "Split bill belum didukung untuk checkout multi-stall"
    );
    expect(MIXED_NFC_GIFT_UNSUPPORTED_MESSAGE).toBe(
      "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall"
    );
  });

  it("builds QRIS body with checkout_id for mixed cart", () => {
    expect(buildPosQrisCreateBody({ amount: 15000, checkoutId: "chk-1" })).toEqual({
      checkout_id: "chk-1",
      amount: 15000,
    });
    expect(buildPosQrisCreateBody({ amount: 15000 })).toEqual({ amount: 15000 });
    // Bayar open bill: QR terikat order (insiden 2026-08-23); checkout menang
    // bila keduanya ada (mixed bill).
    expect(buildPosQrisCreateBody({ amount: 15000, orderId: "ord-1" })).toEqual({
      order_id: "ord-1",
      amount: 15000,
    });
    expect(
      buildPosQrisCreateBody({ amount: 15000, checkoutId: "chk-1", orderId: "ord-1" })
    ).toEqual({ checkout_id: "chk-1", amount: 15000 });
  });

  it("never allows mixed QRIS confirm until Xendit is paid and checkoutId exists", () => {
    expect(
      mayConfirmMixedQris({
        isMixedCart: true,
        method: "qris",
        qrisPaid: false,
        checkoutId: "chk-1",
      })
    ).toBe(false);
    expect(
      mayConfirmMixedQris({
        isMixedCart: true,
        method: "qris",
        qrisPaid: true,
        checkoutId: null,
      })
    ).toBe(false);
    expect(
      mayConfirmMixedQris({
        isMixedCart: true,
        method: "qris",
        qrisPaid: false,
      })
    ).toBe(false);
    expect(
      mayConfirmMixedQris({
        isMixedCart: true,
        method: "qris",
        qrisPaid: true,
        checkoutId: "chk-1",
      })
    ).toBe(true);
  });

  it("does not block cash confirm", () => {
    expect(
      mayConfirmMixedQris({
        isMixedCart: true,
        method: "cash",
        qrisPaid: false,
      })
    ).toBe(true);
  });

  // Bug #3 (insiden 2026-08-25): tanpa batas ini, auto-confirm QRIS retry
  // selamanya kalau settle di server terus gagal — kasir melihat "menyelesaikan…"
  // berputar terus meski Xendit sudah bilang lunas.
  describe("shouldStopQrisAutoRetry", () => {
    it("keeps retrying below the attempt cap", () => {
      expect(shouldStopQrisAutoRetry(0)).toBe(false);
      expect(shouldStopQrisAutoRetry(1)).toBe(false);
      expect(shouldStopQrisAutoRetry(2)).toBe(false);
    });

    it("stops once the cap is reached", () => {
      expect(shouldStopQrisAutoRetry(3)).toBe(true);
      expect(shouldStopQrisAutoRetry(4)).toBe(true);
    });
  });

  // Bug #5 (insiden 2026-08-25): QRIS "jual instan" (bukan open bill, bukan
  // checkout multi-stall) tidak punya order tersimpan sebelum QR muncul —
  // kalau order gagal dibuat setelah customer bayar, uangnya orphan tanpa
  // jejak. Fix: bikin order 'unpaid' dulu (mirror pola checkout), baru QR.
  describe("shouldPrepareOrderForQris", () => {
    it("prepares an order for a plain single-stall QRIS sale", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(true);
    });

    it("skips prepare once an order is already prepared", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: true,
        })
      ).toBe(false);
    });

    it("skips prepare when paying an existing open bill", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: false,
          payingOrderId: "ord-1",
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });

    it("skips prepare for mixed-cart (checkout handles its own prepare)", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "qris",
          isMixedCart: true,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });

    it("skips prepare for non-QRIS methods", () => {
      expect(
        shouldPrepareOrderForQris({
          method: "cash",
          isMixedCart: false,
          payingOrderId: null,
          hasPreparedOrder: false,
        })
      ).toBe(false);
    });
  });

  it("blocks single-stall QRIS confirm until Xendit poll says paid", () => {
    expect(
      mayConfirmMixedQris({
        isMixedCart: false,
        method: "qris",
        qrisPaid: false,
      })
    ).toBe(false);
    expect(
      mayConfirmMixedQris({
        isMixedCart: false,
        method: "qris",
        qrisPaid: true,
      })
    ).toBe(true);
  });

  it("keeps waiting for QRIS while unpaid — including during QR create", () => {
    expect(shouldWaitForQrisConfirm({ method: "qris", qrisPaid: false })).toBe(true);
    expect(shouldWaitForQrisConfirm({ method: "qris", qrisPaid: true })).toBe(false);
    expect(shouldWaitForQrisConfirm({ method: "cash", qrisPaid: false })).toBe(false);
  });

  it("drops the old unpaid mixed checkout when ARK/amount changes", () => {
    expect(
      mixedQrisCheckoutIdForAmount({
        checkoutId: "chk-old",
        boundAmount: 15000,
        currentAmount: 10000,
      })
    ).toBeUndefined();
    expect(
      mixedQrisCheckoutIdForAmount({
        checkoutId: "chk-1",
        boundAmount: 15000,
        currentAmount: 15000,
      })
    ).toBe("chk-1");
  });

  it("still prepares mixed QRIS when qrisLoading is stuck true after amount change", () => {
    expect(
      shouldSkipQrisPrepare({
        qrisLoading: true,
        existingQrAmount: null,
        currentAmount: 10000,
        mixedCheckoutId: "chk-old",
        isMixedCart: true,
      })
    ).toBe(false);
    expect(
      shouldSkipQrisPrepare({
        qrisLoading: true,
        existingQrAmount: 15000,
        currentAmount: 10000,
        mixedCheckoutId: "chk-old",
        isMixedCart: true,
      })
    ).toBe(false);
    expect(
      shouldSkipQrisPrepare({
        qrisLoading: false,
        existingQrAmount: 15000,
        currentAmount: 15000,
        mixedCheckoutId: "chk-1",
        isMixedCart: true,
      })
    ).toBe(true);
    expect(
      shouldSkipQrisPrepare({
        qrisLoading: false,
        existingQrAmount: 15000,
        currentAmount: 15000,
        isMixedCart: false,
        existingQrPaid: true,
      })
    ).toBe(false);
  });

  it("maps mixed checkout response onto one receipt header", () => {
    expect(
      mapPaidSaleToReceiptIds({
        checkout_id: "c1",
        checkout_number: "CHK-20260815-0001",
        queue_number: "A7",
        order_ids: ["o1", "o2"],
      })
    ).toEqual({
      orderId: "c1",
      orderNumber: "CHK-20260815-0001",
      checkoutNumber: "CHK-20260815-0001",
      queueNumber: "A7",
    });
  });
});

describe("phase-1 single-stall cart", () => {
  it("allows first item and same stall", () => {
    expect(canAddItemToSingleStallCart([], "w-a")).toEqual({ ok: true });
    expect(canAddItemToSingleStallCart(["w-a"], "w-a")).toEqual({ ok: true });
  });

  it("rejects missing or other stall", () => {
    expect(canAddItemToSingleStallCart(["w-a"], "w-b").ok).toBe(false);
    expect(canAddItemToSingleStallCart([], null, { centralAllMode: true }).ok).toBe(false);
  });

  it("allows missing stall outside central all mode", () => {
    expect(canAddItemToSingleStallCart([], null).ok).toBe(true);
    expect(canAddItemToSingleStallCart([], undefined, { centralAllMode: false }).ok).toBe(
      true
    );
  });
});

describe("shouldConfirmClearCart", () => {
  it("is true only when draft cart has items", () => {
    expect(shouldConfirmClearCart(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
    expect(shouldConfirmClearCart(JSON.stringify({ items: [] }))).toBe(false);
    expect(shouldConfirmClearCart(null)).toBe(false);
  });
});

describe("resolveSingleStallSellFromAllMode", () => {
  it("sells as the sole cart stall when kasir pusat is in all mode", () => {
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a", "w-a"],
        canSellMixed: true,
      })
    ).toBe("w-a");
  });

  it("returns null for mixed cart or when the central gate is closed", () => {
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a", "w-b"],
        canSellMixed: true,
      })
    ).toBeNull();
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a"],
        canSellMixed: false,
      })
    ).toBeNull();
  });
});

describe("assertAllModeSellStallAssigned", () => {
  it("accepts a stall in the allowed set", () => {
    expect(assertAllModeSellStallAssigned("w-a", ["w-a", "w-b"])).toEqual({ ok: true });
  });

  it("rejects a stall outside the user's allowed stalls", () => {
    const result = assertAllModeSellStallAssigned("w-x", ["w-a", "w-b"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Stall aktif di luar penempatan Anda");
    }
  });
});

describe("allocateCheckoutCharges", () => {
  it("splits proportionally and puts remainder on largest slice", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 10000 },
        { warehouseId: "w-b", subtotal: 5000 },
      ],
      discount: 1500,
      tax: 1350,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].discount + rows[1].discount).toBe(1500);
    expect(rows[0].tax + rows[1].tax).toBe(1350);
    expect(rows[0].warehouseId).toBe("w-a");
    expect(rows[0].discount).toBe(1000);
    expect(rows[1].discount).toBe(500);
  });

  it("returns zeros when checkout subtotal is 0", () => {
    const rows = allocateCheckoutCharges({
      slices: [{ warehouseId: "w-a", subtotal: 0 }],
      discount: 0,
      tax: 0,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].total).toBe(0);
  });
});
