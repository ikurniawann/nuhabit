import { describe, expect, it } from "vitest";
import { summarizeShiftOrders } from "./shift-totals";

describe("summarizeShiftOrders", () => {
  it("menjumlah per metode; tunai custom (transfer) masuk credit; ARK pakai ark_coins_used", () => {
    expect(
      summarizeShiftOrders([
        { total_amount: 10000, payment_method: "cash" },
        { total_amount: "5000", payment_method: null },
        { total_amount: 20000, payment_method: "cash", payment_method_code: "transfer_bca" },
        { total_amount: 7000, payment_method: "QRIS" },
        { total_amount: 3000, payment_method: "debit" },
        { total_amount: 4000, payment_method: "credit" },
        { total_amount: 9000, ark_coins_used: 8000, payment_method: "ark_coin" },
        { total_amount: 6000, payment_method: "nfc_tab" },
        { total_amount: 1000, payment_method: "member_bill" },
      ])
    ).toEqual({ cash: 15000, qris: 7000, debit: 3000, credit: 24000, arkCoin: 8000, nfcTab: 6000 });
  });
});
