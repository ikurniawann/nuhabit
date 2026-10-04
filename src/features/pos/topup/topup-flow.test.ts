import { describe, expect, it } from "vitest";
import {
  canResumeQris,
  creditOf,
  estimateTopupXp,
  initialTopupFlow,
  parseAmountInput,
  paymentMethodLabel,
  projectedBalanceOf,
  topupFlowReducer,
  walletTypeLabel,
  type TopupFlowAction,
  type TopupFlowState,
} from "./topup-flow";
import type { TopupPackage } from "@/features/wallet/api";
import type { TopupResult } from "./types";

const member = { id: "c1", phone: "0812", name: "Ana", ark_coin_balance: 20000 };
const pkg = { id: "pk1", price_idr: 100000, credit_idr: 120000 } as TopupPackage;
const run = (...actions: TopupFlowAction[]) => actions.reduce(topupFlowReducer, initialTopupFlow);
const result = (over: Partial<TopupResult> = {}): TopupResult => ({
  balance_before: 20000,
  balance_after: 70000,
  ark_coins: 50,
  ...over,
});

describe("parseAmountInput", () => {
  it("ambil digit saja", () => {
    expect(parseAmountInput("Rp 50.000")).toBe(50000);
    expect(parseAmountInput("abc")).toBe(0);
  });
});

describe("topupFlowReducer", () => {
  it("pilih member → nominal kosong, langkah enter_amount", () => {
    const state = run({ type: "customerSelected", customer: member });
    expect(state).toMatchObject({ step: "enter_amount", customer: member, topupRp: 0, customRp: "" });
  });

  it("preset & input manual memformat ribuan dan melepas paket", () => {
    let state = run({ type: "customerSelected", customer: member }, { type: "packageSelected", pkg });
    expect(state).toMatchObject({ topupRp: 100000, customRp: "100.000" });
    expect(creditOf(state)).toBe(120000);
    expect(projectedBalanceOf(state)).toBe(140000);
    state = topupFlowReducer(state, { type: "customAmountTyped", raw: "75.5x00" });
    expect(state).toMatchObject({ topupPackage: null, topupRp: 75500, customRp: "75.500" });
    expect(topupFlowReducer(state, { type: "customAmountTyped", raw: "" }).customRp).toBe("");
  });

  it("lanjut bayar hanya bila >= minimum", () => {
    const base = run({ type: "customerSelected", customer: member }, { type: "presetSelected", value: 5000 });
    expect(topupFlowReducer(base, { type: "continueToPayment", minTopup: 10000 }).step).toBe("enter_amount");
    const ok = topupFlowReducer(base, { type: "presetSelected", value: 50000 });
    expect(topupFlowReducer(ok, { type: "continueToPayment", minTopup: 10000 }).step).toBe("payment");
  });

  it("kembali: enter_amount → idle tanpa member; payment/awaiting_qris → enter_amount", () => {
    const amount = run({ type: "customerSelected", customer: member });
    expect(topupFlowReducer(amount, { type: "back" })).toMatchObject({ step: "idle", customer: null });
    const payment: TopupFlowState = { ...amount, step: "payment", error: "x" };
    expect(topupFlowReducer(payment, { type: "back" })).toMatchObject({ step: "enter_amount", error: "" });
  });

  it("gagal submit kembali ke payment dengan pesan", () => {
    const state = run({ type: "customerSelected", customer: member }, { type: "submitStarted" }, {
      type: "submitFailed",
      message: "Terlalu banyak percobaan PIN supervisor. Coba lagi dalam 15 menit.",
    });
    expect(state).toMatchObject({ step: "payment", error: expect.stringContaining("15 menit") });
  });

  it("QRIS terbit lalu sukses: saldo member diperbarui, pending dibersihkan", () => {
    const issued = run(
      { type: "customerSelected", customer: member },
      { type: "presetSelected", value: 50000 },
      { type: "qrisIssued", result: result({ status: "pending", transaction: { id: "t1" } }) }
    );
    expect(issued).toMatchObject({ step: "awaiting_qris", pendingTopupId: "t1" });
    const done = topupFlowReducer(issued, { type: "succeeded", result: result() });
    expect(done).toMatchObject({ step: "success", pendingTopupId: null });
    expect(done.customer?.ark_coin_balance).toBe(70000);
  });

  it("sukses tanpa balance_after memakai saldo proyeksi", () => {
    const state = run({ type: "customerSelected", customer: member }, { type: "presetSelected", value: 50000 }, {
      type: "succeeded",
      result: result({ balance_after: 0 }),
    });
    expect(state.customer?.ark_coin_balance).toBe(70000);
  });

  it("pembatalan hanya mereset bila top-up yang dibatalkan sedang ditunggu", () => {
    const issued = run(
      { type: "customerSelected", customer: member },
      { type: "qrisIssued", result: result({ topup_id: "t1" }) }
    );
    expect(topupFlowReducer(issued, { type: "topupCancelled", topupId: "other" })).toBe(issued);
    expect(topupFlowReducer(issued, { type: "topupCancelled", topupId: "t1" })).toMatchObject({
      step: "enter_amount",
      pendingTopupId: null,
      result: null,
    });
  });

  it("buka ulang QRIS dari riwayat", () => {
    const state = run({ type: "customerSelected", customer: member }, {
      type: "qrisResumed",
      topupId: "t9",
      amount: 25000,
      result: result({ qr_code_url: "u" }),
    });
    expect(state).toMatchObject({ step: "awaiting_qris", pendingTopupId: "t9", topupRp: 25000, payment: "qris" });
  });
});

describe("helpers", () => {
  it("estimasi XP fixed vs per kelipatan", () => {
    expect(estimateTopupXp(55000, { topup_xp_mode: "fixed", topup_xp_value: 10.7, topup_xp_amount_step: 1 })).toBe(10);
    expect(estimateTopupXp(55000, { topup_xp_mode: "per_amount", topup_xp_value: 2, topup_xp_amount_step: 10000 })).toBe(10);
  });

  it("label & QR yang bisa dilanjutkan", () => {
    expect(paymentMethodLabel("credit_card")).toBe("Card");
    expect(paymentMethodLabel("")).toBe("—");
    expect(walletTypeLabel("topup_refund")).toBe("Refund top-up");
    expect(walletTypeLabel("custom")).toBe("custom");
    expect(canResumeQris({ id: "1", amount: 1, status: "pending", payment_method: "qris" })).toBe(true);
    expect(canResumeQris({ id: "1", amount: 1, type: "payment", status: "pending", payment_method: "qris" })).toBe(false);
  });
});
