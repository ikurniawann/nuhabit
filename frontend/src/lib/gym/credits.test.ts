import { describe, expect, it } from "vitest";
import {
  buildReversalEntry,
  checkPackagePurchase,
  computeCreditBalance,
  computeLotRemainders,
  coveredClassTypeIds,
  deriveExpirationEntries,
  expiringLots,
  isClassTypeCovered,
  lotExpiry,
  purchaseTotal,
  validateAdjustment,
  type CreditEntry,
  type CreditLot,
  type PurchasablePackage,
} from "./credits";

const NOW = new Date("2026-10-04T10:00:00+07:00");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const lot = (id: string, credits: number, expiresInDays: number, packageId: string | null = null): CreditLot => ({
  id,
  packageId,
  credits,
  expiresAt: day(expiresInDays),
  createdAt: day(-30),
});

let seq = 0;
const entry = (type: CreditEntry["type"], amount: number, lotId: string | null = null, extra: Partial<CreditEntry> = {}): CreditEntry => ({
  id: `e${++seq}`,
  type,
  amount,
  lotId,
  createdAt: NOW,
  ...extra,
});

const remaindersById = (lots: CreditLot[], entries: CreditEntry[]) =>
  Object.fromEntries(computeLotRemainders(lots, entries).map((r) => [r.lot.id, r.remaining]));

describe("computeCreditBalance", () => {
  it("sums signed amounts", () => {
    expect(computeCreditBalance([entry("top_up", 10, "a"), entry("class_deduction", -2), entry("refund", 1)])).toBe(9);
    expect(computeCreditBalance([])).toBe(0);
  });
});

describe("computeLotRemainders", () => {
  it("consumes the earliest-expiring lot first regardless of insertion order", () => {
    const lots = [lot("late", 10, 60), lot("early", 5, 10)];
    const entries = [entry("top_up", 10, "late"), entry("top_up", 5, "early"), entry("class_deduction", -7)];
    expect(remaindersById(lots, entries)).toEqual({ early: 0, late: 8 });
  });

  it("returns lots sorted by expiry", () => {
    const lots = [lot("b", 1, 20), lot("a", 1, 5)];
    expect(computeLotRemainders(lots, []).map((r) => r.lot.id)).toEqual(["a", "b"]);
  });

  it("refund and positive reversal give consumed credits back to the earliest lot", () => {
    const lots = [lot("a", 5, 10), lot("b", 5, 40)];
    const deduction = entry("class_deduction", -6);
    const entries = [
      entry("top_up", 5, "a"),
      entry("top_up", 5, "b"),
      deduction,
      entry("refund", 2),
      entry("reversal", 1, null, { reversesEntryId: deduction.id }),
    ];
    expect(remaindersById(lots, entries)).toEqual({ a: 2, b: 5 });
    expect(computeCreditBalance(entries)).toBe(7);
  });

  it("pins expiration and top-up reversal to their own lot", () => {
    const lots = [lot("a", 5, -1), lot("b", 4, 30)];
    const entries = [
      entry("top_up", 5, "a"),
      entry("top_up", 4, "b"),
      entry("expiration", -5, "a"),
      entry("reversal", -4, "b"),
    ];
    expect(remaindersById(lots, entries)).toEqual({ a: 0, b: 0 });
  });

  it("negative adjustment consumes like a deduction, positive adjustment owns a lot", () => {
    const lots = [lot("a", 3, 10), lot("adj", 2, 60)];
    const entries = [entry("top_up", 3, "a"), entry("adjustment", 2, "adj"), entry("adjustment", -4)];
    expect(remaindersById(lots, entries)).toEqual({ a: 0, adj: 1 });
    expect(computeCreditBalance(entries)).toBe(1);
  });

  it("sum of remainders matches the ledger balance in a mixed history", () => {
    const lots = [lot("a", 10, -2), lot("b", 5, 3), lot("c", 8, 50)];
    const entries = [
      entry("top_up", 10, "a"),
      entry("top_up", 5, "b"),
      entry("bonus", 8, "c"),
      entry("class_deduction", -4),
      entry("expiration", -6, "a"),
      entry("class_deduction", -2),
      entry("refund", 1),
    ];
    const total = computeLotRemainders(lots, entries).reduce((s, r) => s + r.remaining, 0);
    expect(total).toBe(computeCreditBalance(entries));
    expect(remaindersById(lots, entries)).toEqual({ a: 0, b: 4, c: 8 });
  });
});

describe("deriveExpirationEntries", () => {
  it("expires only the unused part of lapsed lots", () => {
    const lots = [lot("old", 5, -1), lot("new", 5, 30)];
    const entries = [entry("top_up", 5, "old"), entry("top_up", 5, "new"), entry("class_deduction", -2)];
    expect(deriveExpirationEntries(lots, entries, NOW)).toEqual([
      { type: "expiration", amount: -3, lotId: "old", idempotencyKey: "gym-expire:old:0", note: "3 kredit kedaluwarsa" },
    ]);
  });

  it("treats expiry exactly at now as expired", () => {
    const lots = [lot("x", 2, 0)];
    expect(deriveExpirationEntries(lots, [entry("top_up", 2, "x")], NOW)).toHaveLength(1);
  });

  it("is idempotent once the expiration is written", () => {
    const lots = [lot("old", 5, -1)];
    const entries = [entry("top_up", 5, "old"), entry("expiration", -5, "old")];
    expect(deriveExpirationEntries(lots, entries, NOW)).toEqual([]);
  });

  it("uses a fresh key when credits refunded into an expired lot expire again", () => {
    const lots = [lot("old", 5, -1)];
    const entries = [
      entry("top_up", 5, "old"),
      entry("class_deduction", -2),
      entry("expiration", -3, "old"),
      entry("refund", 2),
    ];
    const drafts = deriveExpirationEntries(lots, entries, NOW);
    expect(drafts).toEqual([expect.objectContaining({ amount: -2, idempotencyKey: "gym-expire:old:1" })]);
  });

  it("skips fully used lots", () => {
    const lots = [lot("old", 2, -1)];
    expect(deriveExpirationEntries(lots, [entry("top_up", 2, "old"), entry("class_deduction", -2)], NOW)).toEqual([]);
  });
});

describe("expiring soon", () => {
  const lots = [lot("past", 3, -1), lot("soon", 4, 5), lot("edge", 2, 7), lot("later", 6, 8)];
  const entries = [
    entry("top_up", 3, "past"),
    entry("top_up", 4, "soon"),
    entry("top_up", 2, "edge"),
    entry("top_up", 6, "later"),
    entry("class_deduction", -4),
  ];

  it("counts remaining credits expiring within the window, excluding lapsed lots", () => {
    // past absorbs 3, soon absorbs 1 → soon 3 + edge 2.
    const soon = expiringLots(lots, entries, NOW, 7);
    expect(soon.map((r) => [r.lot.id, r.remaining])).toEqual([
      ["soon", 3],
      ["edge", 2],
    ]);
  });

  it("returns nothing when no lot expires in the window", () => {
    expect(expiringLots(lots, entries, NOW, 1)).toEqual([]);
  });
});

describe("class type coverage", () => {
  const coverage = new Map<string, string[] | null>([
    ["race", ["sim"]],
    ["open", null],
  ]);

  it("restricts to the union of restricted packages", () => {
    const remainders = computeLotRemainders([lot("r", 8, 30, "race")], [entry("top_up", 8, "r")]);
    expect(coveredClassTypeIds(remainders, coverage, NOW)).toEqual(["sim"]);
    expect(isClassTypeCovered(["sim"], "fundamentals")).toBe(false);
  });

  it("an unrestricted live lot lifts the restriction", () => {
    const lots = [lot("r", 8, 30, "race"), lot("o", 2, 30, "open")];
    const remainders = computeLotRemainders(lots, [entry("top_up", 8, "r"), entry("top_up", 2, "o")]);
    expect(coveredClassTypeIds(remainders, coverage, NOW)).toBeNull();
  });

  it("bonus credits without a package are unrestricted, used-up lots are ignored", () => {
    const lots = [lot("r", 1, 30, "race"), lot("b", 1, 30, null)];
    const used = computeLotRemainders(lots, [entry("top_up", 1, "r"), entry("bonus", 1, "b"), entry("class_deduction", -1)]);
    // FIFO by expiry ties on createdAt: "r" is consumed first, the bonus lot remains.
    expect(coveredClassTypeIds(used, coverage, NOW)).toBeNull();
    expect(isClassTypeCovered(null, "anything")).toBe(true);
  });
});

describe("buildReversalEntry", () => {
  it("reverses a top-up against its own lot", () => {
    const original = entry("top_up", 5, "lotA", { sourceType: "purchase", sourceId: "p1" });
    const result = buildReversalEntry(original, { reason: " salah input ", alreadyReversed: false, balance: 5 });
    expect(result).toEqual({
      ok: true,
      draft: {
        type: "reversal",
        amount: -5,
        lotId: "lotA",
        reversesEntryId: original.id,
        sourceType: "purchase",
        sourceId: "p1",
        note: "salah input",
      },
    });
  });

  it("reverses a deduction back into the pool", () => {
    const result = buildReversalEntry(entry("class_deduction", -2), { reason: "kelas batal", alreadyReversed: false, balance: 0 });
    expect(result.ok && result.draft).toMatchObject({ amount: 2, lotId: null });
  });

  it("rejects reversing a reversal, an expiration, a reversed entry, or going negative", () => {
    expect(buildReversalEntry(entry("reversal", 1), { reason: "x", alreadyReversed: false, balance: 9 })).toEqual({
      ok: false,
      problem: "cannot_reverse_reversal",
    });
    expect(buildReversalEntry(entry("expiration", -1, "l"), { reason: "x", alreadyReversed: false, balance: 9 })).toEqual({
      ok: false,
      problem: "cannot_reverse_expiration",
    });
    expect(buildReversalEntry(entry("bonus", 1, "l"), { reason: "x", alreadyReversed: true, balance: 9 })).toEqual({
      ok: false,
      problem: "already_reversed",
    });
    expect(buildReversalEntry(entry("top_up", 5, "l"), { reason: "x", alreadyReversed: false, balance: 4 })).toEqual({
      ok: false,
      problem: "insufficient_balance",
    });
  });
});

describe("validateAdjustment", () => {
  it("requires a non-zero integer, a reason, and a non-negative result", () => {
    expect(validateAdjustment({ amount: 0, reason: "koreksi", balance: 3 })).toMatch(/tidak nol/);
    expect(validateAdjustment({ amount: 1.5, reason: "koreksi", balance: 3 })).toMatch(/bulat/);
    expect(validateAdjustment({ amount: 2, reason: "  ", balance: 3 })).toMatch(/Alasan/);
    expect(validateAdjustment({ amount: -4, reason: "koreksi", balance: 3 })).toMatch(/minus/);
    expect(validateAdjustment({ amount: 5000, reason: "koreksi", balance: 3 })).toMatch(/maksimal/);
    expect(validateAdjustment({ amount: -3, reason: "koreksi", balance: 3 })).toBeNull();
  });
});

describe("checkPackagePurchase", () => {
  const pkg: PurchasablePackage = { id: "p", status: "active", purchaseLimitPerMember: 1, branchId: null };

  it("allows an active package under its limit", () => {
    expect(checkPackagePurchase({ pkg, purchaseCount: 0, memberActive: true })).toBeNull();
  });

  it("enforces the per-member purchase limit", () => {
    expect(checkPackagePurchase({ pkg, purchaseCount: 1, memberActive: true })).toBe("limit_reached");
    expect(checkPackagePurchase({ pkg: { ...pkg, purchaseLimitPerMember: null }, purchaseCount: 50, memberActive: true })).toBeNull();
  });

  it("rejects archived packages and inactive members", () => {
    expect(checkPackagePurchase({ pkg: { ...pkg, status: "archived" }, purchaseCount: 0, memberActive: true })).toBe("archived");
    expect(checkPackagePurchase({ pkg, purchaseCount: 0, memberActive: false })).toBe("member_inactive");
  });

  it("rejects a branch-only package at another branch", () => {
    const branchPkg = { ...pkg, branchId: "b1" };
    expect(checkPackagePurchase({ pkg: branchPkg, purchaseCount: 0, memberActive: true, branchId: "b2" })).toBe("branch_mismatch");
    expect(checkPackagePurchase({ pkg: branchPkg, purchaseCount: 0, memberActive: true, branchId: "b1" })).toBeNull();
    expect(checkPackagePurchase({ pkg: branchPkg, purchaseCount: 0, memberActive: true, branchId: null })).toBeNull();
  });
});

describe("purchaseTotal and lotExpiry", () => {
  it("caps the discount at the price", () => {
    expect(purchaseTotal(800_000, 100_000)).toEqual({ discountIdr: 100_000, totalIdr: 700_000 });
    expect(purchaseTotal(800_000, 900_000)).toEqual({ discountIdr: 800_000, totalIdr: 0 });
    expect(purchaseTotal(800_000, -5)).toEqual({ discountIdr: 0, totalIdr: 800_000 });
  });

  it("adds whole days", () => {
    expect(lotExpiry(NOW, 14).getTime() - NOW.getTime()).toBe(14 * 86_400_000);
  });
});
