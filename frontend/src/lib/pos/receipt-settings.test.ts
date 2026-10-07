import { describe, expect, it } from "vitest";
import {
  DEFAULT_POS_RECEIPT_SETTINGS,
  RECEIPT_LINE_MAX_CHARS,
  RECEIPT_MAX_LINES_PER_SECTION,
  normalizeReceiptLines,
  normalizeReceiptSettings,
  resolveReceiptSettings,
} from "./receipt-settings";

describe("normalizeReceiptLines", () => {
  it("trims, drops empties and non-strings", () => {
    expect(normalizeReceiptLines(["  BCD Coffee  ", "", 42, null, "Dago"])).toEqual([
      "BCD Coffee",
      "Dago",
    ]);
  });

  it("caps line count and line length for 80mm paper", () => {
    const lines = normalizeReceiptLines(Array.from({ length: 10 }, (_, i) => `baris ${i}`));
    expect(lines).toHaveLength(RECEIPT_MAX_LINES_PER_SECTION);
    const long = normalizeReceiptLines(["x".repeat(100)]);
    expect(long[0]).toHaveLength(RECEIPT_LINE_MAX_CHARS);
  });

  it("returns [] for non-arrays", () => {
    expect(normalizeReceiptLines(null)).toEqual([]);
    expect(normalizeReceiptLines("SULU")).toEqual([]);
  });
});

describe("normalizeReceiptSettings", () => {
  it("falls back to safe defaults for missing row", () => {
    expect(normalizeReceiptSettings(null)).toEqual(DEFAULT_POS_RECEIPT_SETTINGS);
  });

  it("keeps show_stall_name true unless explicitly false", () => {
    expect(normalizeReceiptSettings({}).show_stall_name).toBe(true);
    expect(normalizeReceiptSettings({ show_stall_name: false }).show_stall_name).toBe(false);
  });
});

describe("resolveReceiptSettings", () => {
  const rows = [
    { id: "g", header_lines: ["GLOBAL"], footer_lines: [] },
    { id: "b", branch_id: "br-1", header_lines: ["BRANCH"], footer_lines: [] },
    { id: "w", branch_id: "br-1", warehouse_id: "wh-1", header_lines: ["STALL"], footer_lines: [] },
  ];

  it("prefers warehouse over branch over global", () => {
    expect(resolveReceiptSettings(rows, { warehouseId: "wh-1", branchId: "br-1" }).header_lines).toEqual(["STALL"]);
    expect(resolveReceiptSettings(rows, { warehouseId: "wh-x", branchId: "br-1" }).header_lines).toEqual(["BRANCH"]);
    expect(resolveReceiptSettings(rows, { branchId: "br-x" }).header_lines).toEqual(["GLOBAL"]);
  });

  it("returns defaults when no rows at all", () => {
    expect(resolveReceiptSettings([], { warehouseId: "wh-1" })).toEqual(DEFAULT_POS_RECEIPT_SETTINGS);
  });
});
