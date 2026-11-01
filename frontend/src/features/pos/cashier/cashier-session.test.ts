import { describe, expect, it } from "vitest";
import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import {
  cashierSessionReducer as reduce,
  initialCashierSession,
  membershipPercent,
  promoBasis,
  type CashierSessionAction,
  type CashierSessionState,
} from "./cashier-session";

const run = (actions: CashierSessionAction[], from: CashierSessionState = initialCashierSession()) =>
  actions.reduce(reduce, from);

const receipt = { orderId: "o1", total: 10_000, change: 0 } as ReceiptPayload;

describe("cashierSessionReducer: payment lifecycle", () => {
  it("opens, chooses a tender, and resets the tender to cash on success", () => {
    const state = run([
      { type: "paymentOpened" },
      { type: "tenderChosen", method: "ark_coin", arkToUse: 25_000 },
      { type: "processingChanged", processing: true },
    ]);
    expect(state.paymentOpen).toBe(true);
    expect(state.tender).toEqual({ method: "ark_coin", arkToUse: 25_000 });
    expect(state.processing).toBe(true);

    const done = run(
      [
        { type: "paymentSucceeded", clearBill: false, returnToRestaurant: false },
        { type: "processingChanged", processing: false },
      ],
      state
    );
    expect(done.paymentOpen).toBe(false);
    expect(done.tender).toEqual({ method: "cash", arkToUse: 0 });
    expect(done.processing).toBe(false);
  });

  it("keeps the failed tender so the cart panel still previews ARK", () => {
    const state = run([
      { type: "tenderChosen", method: "ark_coin", arkToUse: 5_000 },
      { type: "processingChanged", processing: true },
      { type: "processingChanged", processing: false },
    ]);
    expect(state.tender.method).toBe("ark_coin");
  });

  it("clears the loaded bill key only when asked, keeping persisted item ids", () => {
    const loaded = run([
      { type: "billLoaded", key: "checkout:c1", number: "CO-1", persistedItemIds: ["a", "b"] },
    ]);
    const kept = reduce(loaded, { type: "paymentSucceeded", clearBill: false, returnToRestaurant: false });
    expect(kept.bill.key).toBe("checkout:c1");
    const cleared = reduce(loaded, { type: "paymentSucceeded", clearBill: true, returnToRestaurant: false });
    expect(cleared.bill).toEqual({ key: null, number: "CO-1", persistedItemIds: ["a", "b"] });
  });

  it("reveals the receipt later and returns to the restaurant only after it closes", () => {
    const paid = run([
      { type: "paymentSucceeded", clearBill: false, returnToRestaurant: true },
      { type: "resultRevealed", payload: receipt, kind: "offlined", waPhone: "0812" },
    ]);
    expect(paid.result).toEqual({ payload: receipt, kind: "offlined", waPhone: "0812" });
    expect(paid.returnAfterResult).toBe(true);
    const closed = reduce(paid, { type: "resultClosed" });
    expect(closed.result).toBeNull();
    expect(closed.returnAfterResult).toBe(false);
  });
});

describe("cashierSessionReducer: open bill and handoff", () => {
  it("loading an order bill keeps earlier persisted ids and switches the tender to cash", () => {
    const state = run([
      { type: "tenderChosen", method: "qris", arkToUse: 3 },
      { type: "billLoaded", key: "order:o1", number: "ORD-1" },
    ]);
    expect(state.bill).toEqual({ key: "order:o1", number: "ORD-1", persistedItemIds: [] });
    expect(state.tender).toEqual({ method: "cash", arkToUse: 3 });
  });

  it("appends saved items, or resets them after a new open bill", () => {
    const base = run([{ type: "billLoaded", key: "checkout:c1", number: null, persistedItemIds: ["a"] }]);
    expect(reduce(base, { type: "openBillSaved", appendedItemIds: ["b"] }).bill.persistedItemIds).toEqual([
      "a",
      "b",
    ]);
    expect(reduce(base, { type: "openBillSaved", appendedItemIds: null }).bill.persistedItemIds).toEqual([]);
  });

  it("fresh entry wipes the bill and marks the reset done", () => {
    const state = run([
      { type: "billLoaded", key: "checkout:c1", number: "CO-1", persistedItemIds: ["a"] },
      { type: "freshReset" },
    ]);
    expect(state.bill).toEqual({ key: null, number: null, persistedItemIds: [] });
    expect(state.handoff.freshResetDone).toBe(true);
  });

  it("auto pay opens the modal once", () => {
    const state = run([{ type: "autoPayApplied" }]);
    expect(state.paymentOpen).toBe(true);
    expect(state.handoff.autoPayDone).toBe(true);
  });

  it("tracks saving state and the restaurant handoff key", () => {
    const state = run([
      { type: "savingBillChanged", saving: true },
      { type: "restaurantHandoffApplied", key: "t1|dine_in||" },
    ]);
    expect(state.savingBill).toBe(true);
    expect(state.handoff.restaurantKey).toBe("t1|dine_in||");
  });
});

describe("cashierSessionReducer: promo code", () => {
  it("uppercases input and clears the error on typing", () => {
    const state = run([
      { type: "promoRejected", error: "Kode tidak berlaku" },
      { type: "promoInputChanged", value: "hemat10" },
    ]);
    expect(state.promo.input).toBe("HEMAT10");
    expect(state.promo.error).toBeNull();
  });

  it("applies a promo, clears the input, and finishes the check", () => {
    const state = run([
      { type: "promoInputChanged", value: "hemat" },
      { type: "promoCheckStarted" },
      { type: "promoApplied", promo: { code: "HEMAT", discount: 5_000 } },
      { type: "promoCheckFinished" },
    ]);
    expect(state.promo).toMatchObject({
      applied: { code: "HEMAT", discount: 5_000 },
      input: "",
      busy: false,
      error: null,
    });
  });

  it("drops the applied promo when the basis (subtotal or customer) changes", () => {
    const applied = run([
      { type: "promoBasisChanged", basis: promoBasis(10_000, null) },
      { type: "promoApplied", promo: { code: "HEMAT", discount: 1_000 } },
      { type: "promoRejected", error: "x" },
    ]);
    const changed = reduce(applied, { type: "promoBasisChanged", basis: promoBasis(12_000, null) });
    expect(changed.promo.applied).toBeNull();
    expect(changed.promo.error).toBeNull();
    expect(changed.promo.basis).toBe("12000|");
  });

  it("clearing the cart drops promo, error and input", () => {
    const state = run([
      { type: "promoInputChanged", value: "abc" },
      { type: "promoApplied", promo: { code: "X", discount: 1 } },
      { type: "cartCleared" },
    ]);
    expect(state.promo).toMatchObject({ applied: null, error: null, input: "" });
  });

  it("promoBasis distinguishes customers", () => {
    expect(promoBasis(100, "c1")).not.toBe(promoBasis(100, "c2"));
    expect(promoBasis(100, null)).toBe("100|");
  });
});

describe("cashierSessionReducer: side data", () => {
  it("stores the gift card buyer and customer display payment", () => {
    const state = run([
      { type: "giftCardBuyerSet", buyer: { name: "Ani", phone: "0812" } },
      { type: "cfdPaymentChanged", payment: { method: "cash", amount: 10 } },
    ]);
    expect(state.giftCardBuyer).toEqual({ name: "Ani", phone: "0812" });
    expect(state.cfdPayment).toEqual({ method: "cash", amount: 10 });
  });
});

describe("cashierSessionReducer: season pass", () => {
  const pass = { holderName: "Budi", discountPercent: 15 };
  const withPass = () => run([{ type: "passApplied", pass }]);

  it("keeps the pass until the transaction ends", () => {
    expect(withPass().pass).toEqual(pass);
    expect(run([{ type: "passCleared" }], withPass()).pass).toBeNull();
    expect(run([{ type: "paymentSucceeded", clearBill: true, returnToRestaurant: false }], withPass()).pass).toBeNull();
    expect(run([{ type: "cartCleared" }], withPass()).pass).toBeNull();
    expect(run([{ type: "freshReset" }], withPass()).pass).toBeNull();
    expect(run([{ type: "billLoaded", key: "o2", number: "B-2" }], withPass()).pass).toBeNull();
  });

  it("drops the pass when a new open bill empties the cart but keeps it for appended items", () => {
    expect(run([{ type: "openBillSaved", appendedItemIds: null }], withPass()).pass).toBeNull();
    expect(run([{ type: "openBillSaved", appendedItemIds: ["i1"] }], withPass()).pass).toEqual(pass);
  });

  it("uses the larger of the member tier and the pass discount", () => {
    expect(membershipPercent(10, null)).toBe(10);
    expect(membershipPercent(10, pass)).toBe(15);
    expect(membershipPercent(20, pass)).toBe(20);
  });
});
