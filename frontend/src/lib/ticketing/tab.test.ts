import { describe, expect, test } from "vitest";
import {
  canCharge,
  computeTabSummary,
  directionForChargeType,
  isBalanced,
  settlementPlan,
  type TabEntry,
} from "./tab";

const debit = (amount: number): TabEntry => ({ direction: "debit", amount });
const kredit = (amount: number): TabEntry => ({ direction: "kredit", amount });

describe("directionForChargeType", () => {
  test("uang masuk = kredit, tagihan & refund = debit", () => {
    expect(directionForChargeType("deposit")).toBe("kredit");
    expect(directionForChargeType("pembayaran")).toBe("kredit");
    expect(directionForChargeType("tiket")).toBe("debit");
    expect(directionForChargeType("fnb")).toBe("debit");
    expect(directionForChargeType("denda")).toBe("debit");
    expect(directionForChargeType("koreksi")).toBe("debit");
    expect(directionForChargeType("refund-deposit")).toBe("debit");
  });
});

describe("computeTabSummary", () => {
  test("ledger kosong = nol semua", () => {
    const s = computeTabSummary([]);
    expect(s).toEqual({ debit: 0, kredit: 0, outstanding: 0, saldo: 0 });
  });

  test("postpaid: outstanding = debit - kredit", () => {
    const s = computeTabSummary([debit(50000), debit(35000), kredit(20000)]);
    expect(s.outstanding).toBe(65000);
    expect(s.saldo).toBe(-65000);
  });

  test("prepaid: saldo = deposit - charges", () => {
    const s = computeTabSummary([kredit(200000), debit(50000), debit(30000)]);
    expect(s.saldo).toBe(120000);
  });

  test("nominal desimal tidak drift float", () => {
    const s = computeTabSummary([debit(0.1), debit(0.2), kredit(0.3)]);
    expect(s.outstanding).toBe(0);
    expect(isBalanced(s)).toBe(true);
  });
});

describe("canCharge — guard prepaid", () => {
  const summary = computeTabSummary([kredit(100000), debit(60000)]); // saldo 40k

  test("saldo cukup → boleh", () => {
    expect(
      canCharge({ paymentMode: "prepaid", summary, amount: 40000, creditLimit: null })
    ).toEqual({ ok: true });
  });

  test("saldo kurang → tolak dengan arahan top-up", () => {
    const r = canCharge({
      paymentMode: "prepaid",
      summary,
      amount: 40001,
      creditLimit: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("top-up");
      expect(r.reason).toContain("saldo Rp40.000");
    }
  });

  test("nominal nol/negatif → tolak", () => {
    expect(
      canCharge({ paymentMode: "prepaid", summary, amount: 0, creditLimit: null }).ok
    ).toBe(false);
  });
});

describe("canCharge — guard postpaid credit limit", () => {
  const summary = computeTabSummary([debit(450000)]); // outstanding 450k

  test("masih di bawah plafon → boleh", () => {
    expect(
      canCharge({ paymentMode: "postpaid", summary, amount: 50000, creditLimit: 500000 })
    ).toEqual({ ok: true });
  });

  test("melewati plafon → tolak dengan arahan bayar parsial", () => {
    const r = canCharge({
      paymentMode: "postpaid",
      summary,
      amount: 50001,
      creditLimit: 500000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(
      "Melewati plafon tagihan Rp500.000 — silakan bayar parsial di kasir"
    );
  });

  test("tanpa plafon (null) → selalu boleh", () => {
    expect(
      canCharge({
        paymentMode: "postpaid",
        summary,
        amount: 9_999_999,
        creditLimit: null,
      }).ok
    ).toBe(true);
  });
});

describe("settlementPlan", () => {
  test("postpaid: outstanding jadi amountDue", () => {
    const s = computeTabSummary([debit(150000), debit(80000)]);
    expect(settlementPlan(s)).toEqual({ amountDue: 230000, refundAmount: 0 });
  });

  test("prepaid: sisa saldo jadi refund", () => {
    const s = computeTabSummary([kredit(300000), debit(120000)]);
    expect(settlementPlan(s)).toEqual({ amountDue: 0, refundAmount: 180000 });
  });

  test("prepaid habis pas: tidak ada refund maupun tagihan", () => {
    const s = computeTabSummary([kredit(100000), debit(100000)]);
    expect(settlementPlan(s)).toEqual({ amountDue: 0, refundAmount: 0 });
    expect(isBalanced(s)).toBe(true);
  });

  test("prepaid minus (denda melebihi saldo): kekurangan ditagih", () => {
    const s = computeTabSummary([kredit(50000), debit(60000)]);
    expect(settlementPlan(s)).toEqual({ amountDue: 10000, refundAmount: 0 });
  });

  test("ledger settled (plan dieksekusi) selalu seimbang", () => {
    const before = computeTabSummary([kredit(300000), debit(120000)]);
    const plan = settlementPlan(before);
    const after = computeTabSummary([
      kredit(300000),
      debit(120000),
      ...(plan.amountDue > 0 ? [kredit(plan.amountDue)] : []),
      ...(plan.refundAmount > 0 ? [debit(plan.refundAmount)] : []),
    ]);
    expect(isBalanced(after)).toBe(true);
  });
});
