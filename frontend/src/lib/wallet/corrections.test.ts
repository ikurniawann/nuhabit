import { describe, expect, it } from "vitest";
import { validateAdjustment, validateReversal, validateTopupRefund } from "./corrections";
import { checkFreeAmount, packageAvailableAt, packageBonus, packageInputSchema } from "./packages";
import type { LedgerRow } from "./ledger";

const REASON = "Salah input kasir";
const entry = (partial: Partial<LedgerRow> & Pick<LedgerRow, "type" | "amount">): LedgerRow => ({
  id: "e1",
  status: "completed",
  created_at: "2026-10-01T00:00:00Z",
  metadata: {},
  ...partial,
});

describe("validateAdjustment", () => {
  it("accepts a signed amount with a reason", () => {
    expect(validateAdjustment({ amount: 25_000, reason: REASON, balance: 0 })).toEqual({ ok: true, delta: 25_000 });
    expect(validateAdjustment({ amount: -10_000, reason: REASON, balance: 10_000 })).toEqual({ ok: true, delta: -10_000 });
  });

  it("rejects zero, oversized, missing reason, or negative result", () => {
    expect(validateAdjustment({ amount: 0, reason: REASON, balance: 0 }).ok).toBe(false);
    expect(validateAdjustment({ amount: 200_000_000, reason: REASON, balance: 0 }).ok).toBe(false);
    expect(validateAdjustment({ amount: 5_000, reason: " ok ", balance: 0 }).ok).toBe(false);
    const neg = validateAdjustment({ amount: -10_001, reason: REASON, balance: 10_000 });
    expect(neg).toMatchObject({ ok: false, error: expect.stringContaining("minus") });
  });
});

describe("validateReversal", () => {
  it("reverses a credit lot with a pinned allocation", () => {
    const topup = entry({ type: "topup", amount: 50_000 });
    expect(validateReversal({ entry: topup, reason: REASON, balance: 60_000, alreadyReversed: false })).toEqual({
      ok: true,
      delta: -50_000,
      allocations: [{ lot_id: "e1", amount: 50_000 }],
    });
  });

  it("gives a payment back without allocations", () => {
    const pay = entry({ type: "payment", amount: 35_000 });
    expect(validateReversal({ entry: pay, reason: REASON, balance: 0, alreadyReversed: false })).toEqual({
      ok: true,
      delta: 35_000,
      allocations: [],
    });
  });

  it("refuses double reversal, reversal of a reversal, pending rows and negative balances", () => {
    const topup = entry({ type: "topup", amount: 50_000 });
    expect(validateReversal({ entry: topup, reason: REASON, balance: 60_000, alreadyReversed: true }).ok).toBe(false);
    expect(validateReversal({ entry: entry({ type: "reversal", amount: 5 }), reason: REASON, balance: 9, alreadyReversed: false }).ok).toBe(false);
    expect(validateReversal({ entry: { ...topup, status: "pending" }, reason: REASON, balance: 60_000, alreadyReversed: false }).ok).toBe(false);
    expect(validateReversal({ entry: topup, reason: REASON, balance: 40_000, alreadyReversed: false })).toMatchObject({ ok: false });
    expect(validateReversal({ entry: { ...topup, metadata: { refunded_at: "x" } }, reason: REASON, balance: 90_000, alreadyReversed: false }).ok).toBe(false);
  });
});

describe("validateTopupRefund", () => {
  const topup = { ...entry({ type: "topup", amount: 100_000 }), payment_method: "qris" };
  const bonus = entry({ id: "b1", type: "topup_bonus", amount: 10_000 });
  const base = { topup, bonus, balance: 150_000, alreadyRefunded: false, alreadyReversed: false, method: "transfer", reason: REASON };

  it("removes the top-up plus bonus, refunds the price, flags QRIS as manual", () => {
    expect(validateTopupRefund(base)).toEqual({
      ok: true,
      removeIdr: 110_000,
      refundIdr: 100_000,
      manual: true,
      allocations: [
        { lot_id: "e1", amount: 100_000 },
        { lot_id: "b1", amount: 10_000 },
      ],
    });
  });

  it("refuses FOC, double refunds, bad methods and insufficient balance", () => {
    expect(validateTopupRefund({ ...base, topup: { ...topup, payment_method: "foc" } }).ok).toBe(false);
    expect(validateTopupRefund({ ...base, alreadyRefunded: true }).ok).toBe(false);
    expect(validateTopupRefund({ ...base, alreadyReversed: true }).ok).toBe(false);
    expect(validateTopupRefund({ ...base, method: "qris" }).ok).toBe(false);
    expect(validateTopupRefund({ ...base, balance: 109_999 }).ok).toBe(false);
    expect(validateTopupRefund({ ...base, topup: { ...topup, type: "bonus" } }).ok).toBe(false);
  });

  it("works without a bonus row", () => {
    expect(validateTopupRefund({ ...base, bonus: null, topup: { ...topup, payment_method: "cash" } })).toMatchObject({
      ok: true,
      removeIdr: 100_000,
      manual: false,
    });
  });
});

describe("packages", () => {
  it("computes the bonus and branch availability", () => {
    expect(packageBonus({ price_idr: 100_000, credit_idr: 115_000 })).toBe(15_000);
    expect(packageAvailableAt({ is_active: true, branch_ids: null }, null)).toBe(true);
    expect(packageAvailableAt({ is_active: true, branch_ids: ["b1"] }, "b1")).toBe(true);
    expect(packageAvailableAt({ is_active: true, branch_ids: ["b1"] }, "b2")).toBe(false);
    expect(packageAvailableAt({ is_active: false, branch_ids: null }, "b1")).toBe(false);
  });

  it("rejects a credit below the price", () => {
    expect(packageInputSchema.safeParse({ name: "Hemat", price_idr: 100_000, credit_idr: 90_000 }).success).toBe(false);
    expect(packageInputSchema.safeParse({ name: "Hemat", price_idr: 100_000, credit_idr: 110_000 }).success).toBe(true);
  });

  it("checks free amounts against min and max", () => {
    expect(checkFreeAmount(50_000, 10_000, 1_000_000)).toBeNull();
    expect(checkFreeAmount(5_000, 10_000, 1_000_000)).toMatch(/Minimal/);
    expect(checkFreeAmount(2_000_000, 10_000, 1_000_000)).toMatch(/Maksimal/);
    expect(checkFreeAmount(10_500.5, 10_000, 0)).toMatch(/tidak valid/);
  });
});
