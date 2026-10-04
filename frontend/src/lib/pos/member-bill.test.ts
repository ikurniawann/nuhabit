// Tagihan Member (owner 2026-10-01): cicilan = deposit di akun member; order
// ditutup sekaligus saat saldo menutup semua order terbuka.
import { describe, expect, it } from "vitest";
import {
  computeMemberBillBalance,
  isMemberBillHandler,
  isMemberBillMethod,
  memberBillBaseMethod,
  memberDepositEvent,
  summarizeMemberBillShiftPayments,
  validateMemberBillAmount,
} from "./member-bill";

describe("computeMemberBillBalance", () => {
  it("cicilan sebagian: sisa berkurang, order belum ditutup", () => {
    const b = computeMemberBillBalance({ openTotal: 1_000_000, paymentsTotal: 500_000, settledTotal: 0 });
    expect(b).toMatchObject({ credit: 500_000, outstanding: 500_000, surplus: 0, canSettle: false });
  });

  it("cicilan menutup semua order → siap ditutup", () => {
    const b = computeMemberBillBalance({ openTotal: 1_000_000, paymentsTotal: 1_000_000, settledTotal: 0 });
    expect(b).toMatchObject({ outstanding: 0, canSettle: true });
  });

  it("cicilan lama yang sudah dipakai settlement tidak dihitung lagi", () => {
    const b = computeMemberBillBalance({ openTotal: 200_000, paymentsTotal: 1_100_000, settledTotal: 1_000_000 });
    expect(b).toMatchObject({ credit: 100_000, outstanding: 100_000, canSettle: false });
  });

  it("order di-void setelah dicicil → saldo lebih, bisa langsung ditutup", () => {
    const b = computeMemberBillBalance({ openTotal: 300_000, paymentsTotal: 500_000, settledTotal: 0 });
    expect(b).toMatchObject({ outstanding: 0, surplus: 200_000, canSettle: true });
  });

  it("tanpa order terbuka: tidak ada yang ditutup", () => {
    const b = computeMemberBillBalance({ openTotal: 0, paymentsTotal: 50_000, settledTotal: 0 });
    expect(b).toMatchObject({ outstanding: 0, surplus: 50_000, canSettle: false });
  });
});

describe("validateMemberBillAmount", () => {
  it("menerima nominal 1 s/d sisa tagihan", () => {
    expect(validateMemberBillAmount(500_000, 1_000_000)).toBeNull();
    expect(validateMemberBillAmount(1_000_000, 1_000_000)).toBeNull();
  });
  it("menolak 0, negatif, pecahan, lebih bayar, tagihan kosong", () => {
    expect(validateMemberBillAmount(0, 1000)).toMatch(/lebih dari 0/);
    expect(validateMemberBillAmount(-5, 1000)).toMatch(/lebih dari 0/);
    expect(validateMemberBillAmount("abc", 1000)).toMatch(/lebih dari 0/);
    expect(validateMemberBillAmount(10.5, 1000)).toMatch(/bulat/);
    expect(validateMemberBillAmount(1001, 1000)).toMatch(/melebihi/);
    expect(validateMemberBillAmount(100, 0)).toMatch(/Tidak ada sisa/);
  });
});

describe("metode & jurnal", () => {
  it("hanya tunai, QRIS, kartu/transfer — bukan ARK/NFC/gift card", () => {
    expect(isMemberBillHandler("cash")).toBe(true);
    expect(isMemberBillHandler("credit")).toBe(true);
    expect(isMemberBillHandler("ark_wallet")).toBe(false);
    expect(isMemberBillHandler("gift_card")).toBe(false);
    expect(isMemberBillHandler("nfc_tab")).toBe(false);
  });
  it("metode FOC (gratis) tidak boleh dipakai mencicil", () => {
    expect(isMemberBillMethod({ handler: "cash", code: "transfer_bca", name: "Transfer BCA" })).toBe(true);
    expect(isMemberBillMethod({ handler: "cash", code: "foc", name: "FOC" })).toBe(false);
    expect(isMemberBillMethod({ handler: "credit", code: "x", name: "Free of Charge" })).toBe(false);
  });
  it("kode dasar & event jurnal cicilan per metode", () => {
    expect(memberBillBaseMethod("credit")).toBe("credit_card");
    expect(memberDepositEvent("cash")).toBe("POS_MEMBER_DEPOSIT_CASH");
    expect(memberDepositEvent("qris")).toBe("POS_MEMBER_DEPOSIT_QRIS");
    expect(memberDepositEvent("credit_card")).toBe("POS_MEMBER_DEPOSIT_CARD");
    expect(memberDepositEvent("ark_coin")).toBeNull();
  });
});

describe("summarizeMemberBillShiftPayments", () => {
  it("tunai laci masuk kas; QRIS & kartu dipisah; alias custom 'cash' bukan laci", () => {
    const totals = summarizeMemberBillShiftPayments([
      { amount: 500_000, payment_method: "cash", payment_method_code: "cash" },
      { amount: "200000", payment_method: "qris", payment_method_code: "qris" },
      { amount: 100_000, payment_method: "credit_card", payment_method_code: "debit_bca" },
      { amount: 50_000, payment_method: "cash", payment_method_code: "transfer_bca" },
    ]);
    expect(totals).toEqual({ cash: 500_000, qris: 200_000, card: 150_000, total: 850_000 });
  });
});
