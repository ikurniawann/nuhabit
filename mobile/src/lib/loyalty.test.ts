import { describe, expect, it } from "vitest";

import {
  angka,
  formatIdr,
  idrToArkDisplay,
  isCreditTxn,
  mapOrderRow,
  mapWalletRow,
  tierProgressPercent,
  txnLabel,
  txnSignedArk,
} from "./loyalty";

/**
 * Kasus konversi disalin dari test dashboard (loyalty-settings.test.ts) —
 * kedua sisi WAJIB senada karena menyangkut tampilan saldo member.
 */
describe("idrToArkDisplay", () => {
  it("pembulatan ≥0,5 ke atas, sisanya ke bawah (rate 1000)", () => {
    expect(idrToArkDisplay(2600, 1000)).toBe(3);
    expect(idrToArkDisplay(2400, 1000)).toBe(2);
    expect(idrToArkDisplay(2500, 1000)).toBe(3);
    expect(idrToArkDisplay(250000, 1000)).toBe(250);
    expect(idrToArkDisplay(0, 1000)).toBe(0);
  });

  it("nilai negatif ikut membesar magnitudonya, bukan ke arah nol", () => {
    expect(idrToArkDisplay(-2600, 1000)).toBe(-3);
    expect(idrToArkDisplay(-2400, 1000)).toBe(-2);
    expect(idrToArkDisplay(-2500, 1000)).toBe(-3);
  });

  it("rate lain & fallback", () => {
    expect(idrToArkDisplay(2600, 5000)).toBe(1);
    expect(idrToArkDisplay(12600, 5000)).toBe(3);
    // rate 0/undefined-ish → default 1000
    expect(idrToArkDisplay(2600, 0)).toBe(3);
  });
});

describe("mapWalletRow / mapOrderRow", () => {
  const rate = 1000;

  it("wallet: amount IDR → ARK display bertanda", () => {
    const view = mapWalletRow(
      { id: "w1", type: "payment", amount: -80000, created_at: "2026-08-25T10:00:00Z", notes: null },
      rate
    );
    expect(view.arkAmount).toBe(-80);
    expect(txnLabel(view.type)).toBe("Pembayaran");
  });

  it("arah tampilan dari TIPE — payment positif di DB tetap debit", () => {
    // Data riil dev: payment tersimpan +23000 → harus tampil −23 ARK.
    const payment = txnSignedArk(
      mapWalletRow(
        { id: "w2", type: "payment", amount: 23000, created_at: "", notes: null },
        rate
      )
    );
    expect(payment).toBe(-23);
    expect(isCreditTxn("payment")).toBe(false);

    const refund = txnSignedArk(
      mapWalletRow(
        { id: "w3", type: "refund", amount: 40000, created_at: "", notes: null },
        rate
      )
    );
    expect(refund).toBe(40);
  });

  it("order ARK berdampingan; order non-ARK tetap Rupiah", () => {
    const ark = mapOrderRow(
      { id: "o1", order_number: "ORD-1", total_amount: 80000, payment_method: "ark_coin", created_at: "2026-08-25T10:00:00Z" },
      rate
    );
    expect(ark.paidWithArk).toBe(true);
    expect(ark.arkDisplay).toBe(80);

    const qris = mapOrderRow(
      { id: "o2", order_number: "ORD-2", total_amount: 50000, payment_method: "qris", created_at: "2026-08-25T10:00:00Z" },
      rate
    );
    expect(qris.paidWithArk).toBe(false);
    expect(qris.arkDisplay).toBeNull();
  });
});

describe("tierProgressPercent", () => {
  const tiers = [
    { code: "regular", name: "Regular", min_lifetime_xp: 0 },
    { code: "bronze", name: "Bronze", min_lifetime_xp: 100 },
    { code: "silver", name: "Silver", min_lifetime_xp: 10000 },
    { code: "gold", name: "Gold", min_lifetime_xp: 30000 },
  ];

  it("progres dihitung antara tier kini dan berikutnya", () => {
    // Bronze (min 100) → Silver (min 10000): XP 5050 = tepat tengah.
    expect(tierProgressPercent(5050, tiers, "bronze", true)).toBe(50);
  });

  it("null bila tier tertinggi / data tak lengkap", () => {
    expect(tierProgressPercent(40000, tiers, "gold", false)).toBeNull();
    expect(tierProgressPercent(5050, [], "bronze", true)).toBeNull();
    expect(tierProgressPercent(5050, tiers, undefined, true)).toBeNull();
  });

  it("dibatasi 0–100", () => {
    expect(tierProgressPercent(-5, tiers, "regular", true)).toBe(0);
    expect(tierProgressPercent(999999, tiers, "silver", true)).toBe(100);
  });
});

describe("formatter", () => {
  it("angka & rupiah id-ID", () => {
    expect(angka(1234567)).toBe("1.234.567");
    expect(formatIdr(67350)).toBe("Rp 67.350");
  });

  it("label txn selaras portal Nox", () => {
    expect(txnLabel("topup")).toBe("Top-up");
    expect(txnLabel("topup_bonus")).toBe("Bonus top-up");
    expect(txnLabel("unknown_type")).toBe("unknown_type");
  });
});
