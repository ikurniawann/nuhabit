import { describe, expect, it } from "vitest";

import { formatIdrInput } from "@/components/pos/idr-input";
import { QRIS_MAX_AUTO_CONFIRM_ATTEMPTS } from "@/lib/pos/central-cashier";
import { DEFAULT_POS_PAYMENT_METHODS } from "@/lib/pos/payment-methods";

import {
  arkToUseFor,
  buildConfirmPayload,
  buildPaymentOptions,
  buildQrisConfirmPayload,
  cashSummary,
  initialPaymentState,
  isPaymentValid,
  paymentReducer,
  qrisNeedsPrepare,
  resolveSelection,
  type PaymentAction,
  type PaymentState,
  type QrisCode,
} from "./payment-state";

const QR: QrisCode = {
  amount: 50000,
  qr_string: "000201...",
  qr_id: "qr_1",
  reference_id: "ref_1",
};

function openState(overrides: Partial<PaymentState> = {}): PaymentState {
  return {
    ...initialPaymentState({ open: true, total: 50000, totalAfterArk: 50000, submitting: false }),
    ...overrides,
  };
}

function run(state: PaymentState, ...actions: PaymentAction[]): PaymentState {
  return actions.reduce(paymentReducer, state);
}

function propsChanged(state: PaymentState, patch: Partial<Pick<PaymentState, "open" | "total" | "totalAfterArk" | "submitting">>): PaymentAction {
  return {
    type: "props-changed",
    open: state.open,
    total: state.total,
    totalAfterArk: state.totalAfterArk,
    submitting: state.submitting,
    ...patch,
  };
}

function validity(state: PaymentState, extra: Partial<Parameters<typeof isPaymentValid>[0]> = {}) {
  return isPaymentValid({
    method: state.method,
    focSelected: false,
    customer: null,
    supervisorPin: state.supervisorPin,
    cashAmount: cashSummary(state.method, state.cashInput, state.totalAfterArk).cashAmount,
    total: state.total,
    totalAfterArk: state.totalAfterArk,
    nfcResult: state.nfcResult,
    giftResult: state.giftResult,
    ...extra,
  });
}

describe("cash", () => {
  it("parses formatted IDR input and computes change", () => {
    const state = run(openState(), { type: "cash-input-changed", value: "75.000" });
    expect(state.cashInput).toBe("75000");
    expect(formatIdrInput(state.cashInput)).toBe("75.000");
    expect(cashSummary("cash", state.cashInput, 50000)).toEqual({ cashAmount: 75000, change: 25000 });
    expect(validity(state)).toBe(true);
  });

  it("reports a shortfall and blocks confirm", () => {
    const state = run(openState(), { type: "cash-input-changed", value: "Rp 20.000" });
    expect(cashSummary("cash", state.cashInput, 50000).change).toBe(-30000);
    expect(validity(state)).toBe(false);
  });

  it("clears the input when only non-digits are typed", () => {
    const state = run(openState(), { type: "cash-input-changed", value: "abc" });
    expect(state.cashInput).toBe("");
  });

  it("has no change for non-cash methods", () => {
    expect(cashSummary("qris", "100000", 50000).change).toBe(0);
  });
});

describe("ARK coin", () => {
  const rich = { ark_coin_balance: 80000 };
  const poor = { ark_coin_balance: 30000 };

  it("uses min(balance, total) only for ark_coin", () => {
    expect(arkToUseFor("ark_coin", rich, 50000)).toBe(50000);
    expect(arkToUseFor("ark_coin", poor, 50000)).toBe(30000);
    expect(arkToUseFor("cash", rich, 50000)).toBe(0);
    expect(arkToUseFor("ark_coin", null, 50000)).toBe(0);
  });

  it("is valid only when the balance covers the total", () => {
    const state = openState({ method: "ark_coin", code: "ark_coin" });
    expect(validity(state, { customer: rich })).toBe(true);
    expect(validity(state, { customer: poor })).toBe(false);
    expect(validity(state, { customer: null })).toBe(false);
  });
});

describe("gift card", () => {
  const base = openState({ method: "gift_card", code: "gift_card" });

  it("needs an ok result that covers the full total", () => {
    const covers = run(
      base,
      { type: "gift-check-started" },
      { type: "gift-check-finished", result: { ok: true, balance: 90000, covers: true, code: "ABC" } }
    );
    expect(covers.giftChecking).toBe(false);
    expect(validity(covers)).toBe(true);

    const short = run(base, {
      type: "gift-check-finished",
      result: { ok: true, balance: 10000, covers: false, code: "ABC" },
    });
    expect(validity(short)).toBe(false);

    const rejected = run(base, {
      type: "gift-check-finished",
      result: { ok: false, reason: "Kartu kedaluwarsa", code: "ABC" },
    });
    expect(validity(rejected)).toBe(false);
  });

  it("drops the result when the code is edited", () => {
    const state = run(
      base,
      { type: "gift-check-finished", result: { ok: true, covers: true, code: "ABC" } },
      { type: "gift-input-changed", value: "abcd" }
    );
    expect(state.giftInput).toBe("ABCD");
    expect(state.giftResult).toBeNull();
  });

  it("drops the result when the total changes", () => {
    const checked = run(base, {
      type: "gift-check-finished",
      result: { ok: true, covers: true, code: "ABC" },
    });
    expect(run(checked, propsChanged(checked, { total: 60000 })).giftResult).toBeNull();
    expect(run(checked, propsChanged(checked, { submitting: true })).giftResult).not.toBeNull();
  });
});

describe("NFC tab", () => {
  it("clears the input on check and is valid only for an ok result", () => {
    const base = run(openState({ method: "nfc_tab", code: "nfc_tab" }), {
      type: "nfc-input-changed",
      value: "04AABB",
    });
    const checking = run(base, { type: "nfc-check-started" });
    expect(checking.nfcInput).toBe("");
    expect(checking.nfcChecking).toBe(true);

    const ok = run(checking, {
      type: "nfc-check-finished",
      result: { ok: true, uid: "04AABB", contactName: "Budi" },
    });
    expect(validity(ok)).toBe(true);

    const blocked = run(checking, {
      type: "nfc-check-finished",
      result: { ok: false, reason: "Tab ditutup", uid: "04AABB" },
    });
    expect(validity(blocked)).toBe(false);
  });
});

describe("FOC supervisor PIN", () => {
  const customer = { ark_coin_balance: 0 };

  it("keeps digits only and resets when another method is picked", () => {
    const state = run(openState(), { type: "supervisor-pin-changed", value: "12a3-4" });
    expect(state.supervisorPin).toBe("1234");
    expect(run(state, { type: "method-picked", code: "cash", method: "cash" }).supervisorPin).toBe("");
  });

  it("needs a customer and a 4-6 digit PIN", () => {
    const withPin = (pin: string) => openState({ supervisorPin: pin });
    expect(validity(withPin("1234"), { focSelected: true, customer })).toBe(true);
    expect(validity(withPin("123456"), { focSelected: true, customer })).toBe(true);
    expect(validity(withPin("123"), { focSelected: true, customer })).toBe(false);
    expect(validity(withPin("1234567"), { focSelected: true, customer })).toBe(false);
    expect(validity(withPin("1234"), { focSelected: true, customer: null })).toBe(false);
  });
});

describe("QRIS lifecycle", () => {
  const qrisOpen = () =>
    run(openState(), { type: "method-picked", code: "qris", method: "qris" });
  const active = { active: true, totalAfterArk: 50000, isMixedCart: false };

  it("prepares, becomes ready, then settles", () => {
    const picked = qrisOpen();
    expect(picked.qris.status).toBe("idle");
    expect(qrisNeedsPrepare(picked, active)).toBe(true);
    expect(qrisNeedsPrepare(picked, { ...active, active: false })).toBe(false);

    const ready = run(picked, { type: "qris-ready", qr: QR });
    expect(ready.qris).toEqual({ status: "ready", qr: QR });
    expect(qrisNeedsPrepare(ready, active)).toBe(false);

    const paid = run(ready, { type: "qris-settle-started", qrId: "qr_1" });
    expect(paid.qris.status).toBe("paid");
    expect(qrisNeedsPrepare(paid, active)).toBe(false);
  });

  it("stops auto-retry after the max attempts and allows a manual retry", () => {
    let state = run(qrisOpen(), { type: "qris-ready", qr: QR });
    for (let attempt = 1; attempt < QRIS_MAX_AUTO_CONFIRM_ATTEMPTS; attempt += 1) {
      state = run(
        state,
        { type: "qris-settle-started", qrId: "qr_1" },
        { type: "qris-settle-failed", qrId: "qr_1", message: "409" }
      );
      expect(state.qris.status).toBe("ready");
      expect(state.settleAttempts).toBe(attempt);
    }
    state = run(
      state,
      { type: "qris-settle-started", qrId: "qr_1" },
      { type: "qris-settle-failed", qrId: "qr_1", message: "Nominal berubah" }
    );
    expect(state.qris).toEqual({ status: "settle_error", qr: QR, message: "Nominal berubah" });

    const retried = run(state, { type: "qris-settle-started", qrId: "qr_1" });
    expect(retried.qris.status).toBe("paid");
    expect(retried.settleAttempts).toBe(0);
  });

  it("ignores settle results for another QR", () => {
    const paid = run(
      qrisOpen(),
      { type: "qris-ready", qr: QR },
      { type: "qris-settle-started", qrId: "qr_1" }
    );
    expect(run(paid, { type: "qris-settle-failed", qrId: "old", message: "x" })).toBe(paid);
  });

  it("goes back to polling when submitting ends without a settle error", () => {
    const paid = run(
      qrisOpen(),
      { type: "qris-ready", qr: QR },
      { type: "qris-settle-started", qrId: "qr_1" }
    );
    const submitting = run(paid, propsChanged(paid, { submitting: true }));
    const done = run(submitting, propsChanged(submitting, { submitting: false }));
    expect(done.qris.status).toBe("ready");
  });

  it("does not retry QR creation after the server refused it", () => {
    const failed = run(qrisOpen(), { type: "qris-unavailable", error: "QR belum dikonfigurasi" });
    expect(qrisNeedsPrepare(failed, active)).toBe(false);
  });

  it("needs a new QR for a mixed cart without a matching checkout", () => {
    const ready = run(qrisOpen(), { type: "qris-ready", qr: QR });
    expect(qrisNeedsPrepare(ready, { ...active, isMixedCart: true })).toBe(true);
    const bound = run(ready, {
      type: "checkout-prepared",
      checkout: { checkout_id: "co_1", amount: 50000 },
    });
    expect(qrisNeedsPrepare(bound, { ...active, isMixedCart: true })).toBe(false);
  });

  it("total change invalidates the QR, prepared checkout and prepared order", () => {
    const ready = run(
      qrisOpen(),
      { type: "checkout-prepared", checkout: { checkout_id: "co_1", amount: 50000 } },
      { type: "order-prepared", order: { order_id: "ord_1" } },
      { type: "qris-ready", qr: QR }
    );
    const changed = run(ready, propsChanged(ready, { totalAfterArk: 65000 }));
    expect(changed.qris.status).toBe("idle");
    expect(changed.preparedCheckout).toBeNull();
    expect(changed.preparedOrder).toBeNull();
    expect(changed.abandon).toEqual([
      { kind: "checkout", id: "co_1" },
      { kind: "order", id: "ord_1" },
    ]);
  });

  it("keeps a paid order when the total changes mid-settle", () => {
    const paid = run(
      qrisOpen(),
      { type: "order-prepared", order: { order_id: "ord_1" } },
      { type: "qris-ready", qr: QR },
      { type: "qris-settle-started", qrId: "qr_1" }
    );
    const changed = run(paid, propsChanged(paid, { totalAfterArk: 0 }));
    expect(changed.abandon).toEqual([]);
    expect(changed.preparedOrder).toEqual({ order_id: "ord_1" });
  });

  it("leaving QRIS resets it and abandons unpaid preparations", () => {
    const ready = run(
      qrisOpen(),
      { type: "order-prepared", order: { order_id: "ord_1" } },
      { type: "qris-ready", qr: QR }
    );
    const left = run(ready, { type: "method-picked", code: "cash", method: "cash" });
    expect(left.qris.status).toBe("idle");
    expect(left.preparedOrder).toBeNull();
    expect(left.abandon).toEqual([{ kind: "order", id: "ord_1" }]);
  });

  it("never abandons once Xendit reported paid", () => {
    const paid = run(
      qrisOpen(),
      { type: "order-prepared", order: { order_id: "ord_1" } },
      { type: "qris-ready", qr: QR },
      { type: "qris-settle-started", qrId: "qr_1" }
    );
    const closed = run(paid, propsChanged(paid, { open: false }));
    expect(closed.abandon).toEqual([]);
  });
});

describe("close", () => {
  it("resets everything and abandons unpaid preparations", () => {
    const busy = run(
      openState(),
      { type: "cash-input-changed", value: "10000" },
      { type: "supervisor-pin-changed", value: "1234" },
      { type: "nfc-input-changed", value: "04AA" },
      { type: "gift-input-changed", value: "abc" },
      { type: "method-picked", code: "qris", method: "qris" },
      { type: "checkout-prepared", checkout: { checkout_id: "co_1", amount: 50000 } },
      { type: "qris-ready", qr: QR }
    );
    const closed = run(busy, propsChanged(busy, { open: false }));
    expect(closed).toEqual({
      ...initialPaymentState({ open: false, total: 50000, totalAfterArk: 50000, submitting: false }),
      abandon: [{ kind: "checkout", id: "co_1" }],
    });
  });

  it("does not abandon while the parent is submitting", () => {
    const busy = run(
      openState(),
      { type: "method-picked", code: "qris", method: "qris" },
      { type: "order-prepared", order: { order_id: "ord_1" } }
    );
    const closed = run(busy, propsChanged(busy, { open: false, submitting: true }));
    expect(closed.abandon).toEqual([]);
    expect(closed.preparedOrder).toBeNull();
  });
});

describe("payment options and blocked tenders", () => {
  const options = buildPaymentOptions(undefined, { nfcTab: true, giftCard: true });
  const plain = { isMixedCart: false, isCheckoutBill: false };

  it("hides NFC tab and gift card without their check callbacks", () => {
    const codes = buildPaymentOptions([], { nfcTab: false, giftCard: false }).map((o) => o.code);
    expect(codes).toEqual(["cash", "qris", "credit_card", "ark_coin"]);
    expect(options.map((o) => o.code)).toEqual(
      DEFAULT_POS_PAYMENT_METHODS.filter((m) => m.is_active).map((m) => m.code)
    );
    expect(options.find((o) => o.code === "ark_coin")?.cashierKey).toBe("ark_coin");
  });

  it("falls back to cash for NFC/gift on a mixed cart", () => {
    const ctx = { ...plain, isMixedCart: true };
    expect(resolveSelection({ code: "nfc_tab", method: "nfc_tab" }, options, ctx)).toEqual({ code: "cash", method: "cash" });
    expect(resolveSelection({ code: "gift_card", method: "gift_card" }, options, ctx)).toEqual({ code: "cash", method: "cash" });
    expect(resolveSelection({ code: "ark_coin", method: "ark_coin" }, options, ctx).method).toBe("ark_coin");
  });

  it("falls back to cash for ARK/NFC/gift on a checkout bill", () => {
    const ctx = { ...plain, isCheckoutBill: true };
    expect(resolveSelection({ code: "ark_coin", method: "ark_coin" }, options, ctx)).toEqual({ code: "cash", method: "cash" });
    expect(resolveSelection({ code: "qris", method: "qris" }, options, ctx).method).toBe("qris");
  });

  it("selects the first option when the code is not in the catalog", () => {
    const qrisOnly = options.filter((o) => o.code === "qris");
    expect(resolveSelection({ code: "cash", method: "cash" }, qrisOnly, plain)).toEqual({ code: "qris", method: "qris" });
  });
});

describe("confirm payloads", () => {
  it("binds the QRIS payload to the open bill before a prepared order", () => {
    const base = { qr: QR, preparedCheckout: null, preparedOrder: { order_id: "ord_1", order_number: "A-1" } };
    expect(buildQrisConfirmPayload({ ...base, payingOrderId: "bill_9" }).orderId).toBe("bill_9");
    const instant = buildQrisConfirmPayload({ ...base, payingOrderId: null });
    expect(instant).toMatchObject({
      method: "qris",
      orderId: "ord_1",
      orderNumber: "A-1",
      xenditQrId: "qr_1",
      xenditExternalId: "ref_1",
      paymentMethodCode: "qris",
    });
  });

  it("passes NFC uid, gift code and supervisor PIN only for their methods", () => {
    const common = {
      code: "x",
      cashAmount: 0,
      arkToUse: 0,
      supervisorPin: " 1234 ",
      nfcResult: { ok: true, uid: "04AA" },
      giftResult: { ok: true, code: "GIFT" },
    };
    expect(buildConfirmPayload({ ...common, method: "nfc_tab", focSelected: false })).toMatchObject({
      nfcTabUid: "04AA",
      giftCardCode: undefined,
      supervisorPin: undefined,
    });
    expect(buildConfirmPayload({ ...common, method: "gift_card", focSelected: false }).giftCardCode).toBe("GIFT");
    expect(buildConfirmPayload({ ...common, method: "cash", focSelected: true }).supervisorPin).toBe("1234");
    expect(buildConfirmPayload({ ...common, method: "cash", focSelected: false, cashAmount: 75000 }).cashReceived).toBe("75000");
  });
});
