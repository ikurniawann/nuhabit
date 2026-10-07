import { describe, expect, it } from "vitest";
import {
  computeLotRemainders,
  expiresAtFor,
  isCreditEntry,
  planExpirySweep,
  selectExpiryReminders,
  shouldNudgeLowBalance,
  signedDelta,
  type LedgerRow,
} from "./ledger";

const NOW = new Date("2026-10-04T00:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

let seq = 0;
function row(partial: Partial<LedgerRow> & Pick<LedgerRow, "type" | "amount">): LedgerRow {
  seq += 1;
  return { id: `r${seq}`, status: "completed", created_at: day(-100 + seq), expires_at: null, metadata: {}, ...partial };
}

const remainderOf = (rows: LedgerRow[], id: string) =>
  computeLotRemainders(rows).find((r) => r.lot.id === id)?.remaining;

describe("signedDelta", () => {
  it("treats credit types as positive and debit types as negative regardless of stored sign", () => {
    expect(signedDelta(row({ type: "topup", amount: 50_000 }))).toBe(50_000);
    expect(signedDelta(row({ type: "payment", amount: 35_000 }))).toBe(-35_000);
    expect(signedDelta(row({ type: "payment", amount: -35_000 }))).toBe(-35_000);
    expect(signedDelta(row({ type: "withdrawal", amount: 20_000 }))).toBe(-20_000);
  });

  it("uses the balance difference for signed types", () => {
    expect(signedDelta(row({ type: "adjustment", amount: 10_000, balance_before: 50_000, balance_after: 40_000 }))).toBe(-10_000);
    expect(signedDelta(row({ type: "reversal", amount: -5_000, balance_before: 0, balance_after: 0 }))).toBe(-5_000);
  });

  it("labels credits for display", () => {
    expect(isCreditEntry("topup", 1)).toBe(true);
    expect(isCreditEntry("adjustment", -1)).toBe(false);
    expect(isCreditEntry("reversal", 5)).toBe(true);
    expect(isCreditEntry("expiration", -5)).toBe(false);
  });
});

describe("computeLotRemainders", () => {
  it("spends the soonest-expiring lot first and never-expiring lots last", () => {
    const legacy = row({ type: "topup", amount: 100_000, expires_at: null });
    const late = row({ type: "topup", amount: 50_000, expires_at: day(60) });
    const soon = row({ type: "topup_bonus", amount: 20_000, expires_at: day(10) });
    const pay = row({ type: "payment", amount: 30_000 });
    const rows = [legacy, late, soon, pay];
    expect(remainderOf(rows, soon.id)).toBe(0);
    expect(remainderOf(rows, late.id)).toBe(40_000);
    expect(remainderOf(rows, legacy.id)).toBe(100_000);
  });

  it("ignores pending rows", () => {
    const lot = row({ type: "topup", amount: 50_000, expires_at: day(5) });
    const pending = row({ type: "topup", amount: 10_000, status: "pending", expires_at: day(1) });
    const pay = row({ type: "payment", amount: 5_000, status: "pending" });
    const out = computeLotRemainders([lot, pending, pay]);
    expect(out).toHaveLength(1);
    expect(out[0].remaining).toBe(50_000);
  });

  it("pins allocated debits to their lot and spills the excess into FIFO consumption", () => {
    const a = row({ type: "topup", amount: 30_000, expires_at: day(5) });
    const b = row({ type: "topup", amount: 30_000, expires_at: day(10) });
    const pinned = row({
      type: "topup_refund",
      amount: -40_000,
      metadata: { lot_allocations: [{ lot_id: b.id, amount: 40_000 }] },
    });
    const rows = [a, b, pinned];
    expect(remainderOf(rows, b.id)).toBe(0);
    expect(remainderOf(rows, a.id)).toBe(20_000);
  });

  it("returns credits to the pool when a debit is reversed", () => {
    const lot = row({ type: "topup", amount: 50_000, expires_at: day(5) });
    const pay = row({ type: "payment", amount: 20_000 });
    const back = row({ type: "reversal", amount: 20_000, balance_before: 30_000, balance_after: 50_000 });
    expect(remainderOf([lot, pay, back], lot.id)).toBe(50_000);
  });

  it("treats a positive adjustment as its own lot and a negative one as consumption", () => {
    const plus = row({ type: "adjustment", amount: 10_000, balance_before: 0, balance_after: 10_000, expires_at: day(3) });
    const minus = row({ type: "adjustment", amount: -4_000, balance_before: 10_000, balance_after: 6_000 });
    expect(remainderOf([plus, minus], plus.id)).toBe(6_000);
  });

  it("charges allocations to unknown lots as general consumption", () => {
    const lot = row({ type: "topup", amount: 10_000 });
    const ghost = row({ type: "expiration", amount: -3_000, metadata: { lot_allocations: [{ lot_id: "gone", amount: 3_000 }] } });
    expect(remainderOf([lot, ghost], lot.id)).toBe(7_000);
  });
});

describe("planExpirySweep", () => {
  it("expires only past-due remainders and marks every due lot processed", () => {
    const expired = row({ type: "topup", amount: 50_000, expires_at: day(-1) });
    const spent = row({ type: "bonus", amount: 10_000, expires_at: day(-2) });
    const live = row({ type: "topup", amount: 30_000, expires_at: day(30) });
    const pay = row({ type: "payment", amount: 15_000 });
    const plan = planExpirySweep({ rows: [expired, spent, live, pay], balance: 75_000, now: NOW });
    // pay 15k: spent (exp -2d) takes 10k, expired (exp -1d) takes 5k.
    expect(plan.entries).toEqual([{ lot_id: expired.id, amount: 45_000, balance_before: 75_000, balance_after: 30_000 }]);
    expect(plan.processedLotIds.sort()).toEqual([expired.id, spent.id].sort());
  });

  it("never expires more than the stored balance", () => {
    const lot = row({ type: "topup", amount: 50_000, expires_at: day(-1) });
    const plan = planExpirySweep({ rows: [lot], balance: 20_000, now: NOW });
    expect(plan.entries[0]).toMatchObject({ amount: 20_000, balance_after: 0 });
  });

  it("is idempotent: a second pass after writing the expiration emits nothing", () => {
    const lot = row({ type: "topup", amount: 50_000, expires_at: day(-1) });
    const first = planExpirySweep({ rows: [lot], balance: 50_000, now: NOW });
    const written = row({
      type: "expiration",
      amount: -first.entries[0].amount,
      metadata: { lot_id: lot.id, lot_allocations: [{ lot_id: lot.id, amount: first.entries[0].amount }] },
    });
    const second = planExpirySweep({ rows: [lot, written], balance: 0, now: NOW });
    expect(second.entries).toEqual([]);
  });

  it("skips lots already holding an expiration row", () => {
    const lot = row({ type: "topup", amount: 50_000, expires_at: day(-1) });
    const plan = planExpirySweep({ rows: [lot], balance: 50_000, now: NOW, alreadyExpiredLotIds: new Set([lot.id]) });
    expect(plan.entries).toEqual([]);
    expect(plan.processedLotIds).toEqual([lot.id]);
  });
});

describe("selectExpiryReminders", () => {
  it("picks lots expiring inside the window that still hold credit and were not reminded", () => {
    const soon = row({ type: "topup", amount: 20_000, expires_at: day(3) });
    const reminded = row({ type: "topup", amount: 20_000, expires_at: day(4) });
    const far = row({ type: "topup", amount: 20_000, expires_at: day(30) });
    const past = row({ type: "topup", amount: 20_000, expires_at: day(-1) });
    const picked = selectExpiryReminders({
      rows: [soon, reminded, far, past],
      now: NOW,
      withinDays: 7,
      remindedLotIds: new Set([reminded.id]),
    });
    expect(picked.map((p) => p.lot_id)).toEqual([soon.id]);
    expect(picked[0].remaining).toBe(20_000);
  });

  it("skips fully spent lots and a zero-day window", () => {
    const soon = row({ type: "topup", amount: 20_000, expires_at: day(3) });
    const pay = row({ type: "payment", amount: 20_000 });
    expect(selectExpiryReminders({ rows: [soon, pay], now: NOW, withinDays: 7, remindedLotIds: new Set() })).toEqual([]);
    expect(selectExpiryReminders({ rows: [soon], now: NOW, withinDays: 0, remindedLotIds: new Set() })).toEqual([]);
  });
});

describe("shouldNudgeLowBalance", () => {
  const base = { threshold: 50_000, balance: 20_000, crossedAt: new Date(day(-1)), lastNudgeAt: null, now: NOW };

  it("nudges after a fresh drop below the threshold", () => {
    expect(shouldNudgeLowBalance(base)).toBe(true);
  });

  it("does nothing when disabled, above threshold, or without a drop", () => {
    expect(shouldNudgeLowBalance({ ...base, threshold: 0 })).toBe(false);
    expect(shouldNudgeLowBalance({ ...base, balance: 50_000 })).toBe(false);
    expect(shouldNudgeLowBalance({ ...base, crossedAt: null })).toBe(false);
  });

  it("waits 7 days between nudges and needs a new drop after the last one", () => {
    expect(shouldNudgeLowBalance({ ...base, lastNudgeAt: new Date(day(-3)) })).toBe(false);
    expect(shouldNudgeLowBalance({ ...base, lastNudgeAt: new Date(day(-8)) })).toBe(true);
    expect(
      shouldNudgeLowBalance({ ...base, crossedAt: new Date(day(-9)), lastNudgeAt: new Date(day(-8)) })
    ).toBe(false);
  });
});

describe("expiresAtFor", () => {
  it("adds validity days, null means no expiry", () => {
    expect(expiresAtFor(30, NOW)?.toISOString()).toBe(day(30));
    expect(expiresAtFor(null, NOW)).toBeNull();
    expect(expiresAtFor(0, NOW)).toBeNull();
  });
});
