import { describe, expect, it } from "vitest";
import {
  buildJournalLinesFromMapping,
  mappingHasRequiredAccounts,
  resolveAmountFromSource,
} from "@/lib/accounting/journal-mapping-posting";

describe("resolveAmountFromSource", () => {
  it("reads amount map by source key", () => {
    expect(
      resolveAmountFromSource("TOTAL", { TOTAL: 1200, SUBTOTAL: 1000, TAX: 200 })
    ).toBe(1200);
    expect(resolveAmountFromSource("PAID", { PAID: 500 })).toBe(500);
  });

  it("returns 0 for missing or non-positive amounts", () => {
    expect(resolveAmountFromSource("TAX", { TOTAL: 10 })).toBe(0);
    expect(resolveAmountFromSource("TOTAL", { TOTAL: 0 })).toBe(0);
    expect(resolveAmountFromSource("TOTAL", { TOTAL: -5 })).toBe(0);
  });
});

describe("mappingHasRequiredAccounts", () => {
  it("requires account_id on required lines only", () => {
    expect(
      mappingHasRequiredAccounts([
        { account_id: "a", is_required: true },
        { account_id: null, is_required: false },
      ])
    ).toBe(true);
    expect(
      mappingHasRequiredAccounts([
        { account_id: null, is_required: true },
        { account_id: "b", is_required: true },
      ])
    ).toBe(false);
  });
});

describe("buildJournalLinesFromMapping", () => {
  const baseLines = [
    {
      entry_side: "DEBIT" as const,
      account_id: "inv",
      amount_source: "TOTAL" as const,
      sort_order: 10,
      is_required: true,
      line_role: "INVENTORY",
    },
    {
      entry_side: "CREDIT" as const,
      account_id: "grni",
      amount_source: "TOTAL" as const,
      sort_order: 20,
      is_required: true,
      line_role: "GRNI",
    },
  ];

  it("builds balanced debit/credit lines from TOTAL", () => {
    const built = buildJournalLinesFromMapping({
      lines: baseLines,
      amounts: { TOTAL: 1500 },
    });
    expect(built.ready).toBe(true);
    expect(built.journalLines).toHaveLength(2);
    expect(built.journalLines[0].amount).toBe(1500);
    expect(built.journalLines[1].amount).toBe(1500);
  });

  it("skips zero optional lines and fails when required amount is 0", () => {
    const incomplete = buildJournalLinesFromMapping({
      lines: baseLines,
      amounts: { SUBTOTAL: 10 },
    });
    expect(incomplete.ready).toBe(false);
  });

  it("returns not ready when required COA missing", () => {
    const built = buildJournalLinesFromMapping({
      lines: [
        { ...baseLines[0], account_id: null },
        baseLines[1],
      ],
      amounts: { TOTAL: 100 },
    });
    expect(built.ready).toBe(false);
    expect(built.reason).toMatch(/belum lengkap|belum diisi/i);
  });

  it("returns not ready when optional DISCOUNT has amount but no COA", () => {
    const built = buildJournalLinesFromMapping({
      lines: [
        {
          entry_side: "DEBIT",
          account_id: "cash",
          amount_source: "TOTAL",
          sort_order: 10,
          is_required: true,
          line_role: "CASH",
        },
        {
          entry_side: "DEBIT",
          account_id: null,
          amount_source: "DISCOUNT",
          sort_order: 15,
          is_required: false,
          line_role: "DISCOUNT",
        },
        {
          entry_side: "CREDIT",
          account_id: "rev",
          amount_source: "SUBTOTAL",
          sort_order: 20,
          is_required: true,
          line_role: "REVENUE",
        },
      ],
      amounts: { TOTAL: 36_000, DISCOUNT: 4_000, SUBTOTAL: 40_000 },
    });
    expect(built.ready).toBe(false);
    expect(built.reason).toMatch(/DISCOUNT/i);
  });
});
