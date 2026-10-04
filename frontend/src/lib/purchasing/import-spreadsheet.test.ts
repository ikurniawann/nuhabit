import { describe, expect, it } from "vitest";
import {
  createHeaderNormalizer,
  emptyToNull,
  ImportTally,
  isBlankRow,
  matrixToRows,
  nextCodeSequence,
  parseActiveCell,
  parseCsvMatrix,
  parseNumberCell,
  parseOptionalIntCell,
  spreadsheetCell,
} from "./import-spreadsheet";

describe("parseCsvMatrix", () => {
  it("splits on commas outside quotes and drops blank lines", () => {
    expect(parseCsvMatrix('kode,nama\n\nA1, "Gula, pasir" \n')).toEqual([
      ["kode", "nama"],
      ["A1", "Gula, pasir"],
    ]);
  });
});

describe("header + rows", () => {
  it("normalises headers through aliases and numbers rows like the file", () => {
    const normalize = createHeaderNormalizer({ name: "nama" });
    expect(normalize("Stok Awal")).toBe("stok_awal");
    expect(matrixToRows([["Kode", "Name"], ["A1"]], normalize)).toEqual([
      { rowNumber: 2, data: { kode: "A1", nama: "" } },
    ]);
  });

  it("detects blank rows over the given keys", () => {
    expect(isBlankRow({ kode: " ", nama: "" }, ["kode", "nama"])).toBe(true);
    expect(isBlankRow({ kode: "A" }, ["kode", "nama"])).toBe(false);
  });
});

describe("cell parsers", () => {
  it("parses numbers with thousand commas and falls back", () => {
    expect(parseNumberCell("1,250.5")).toBe(1250.5);
    expect(parseNumberCell(" ", 30)).toBe(30);
    expect(parseNumberCell("abc", 1)).toBe(1);
  });

  it("parses optional ints, null-empties and active flags", () => {
    expect(parseOptionalIntCell("14 hari")).toBe(14);
    expect(parseOptionalIntCell("")).toBeNull();
    expect(emptyToNull("  ")).toBeNull();
    expect(emptyToNull(" x ")).toBe("x");
    expect(parseActiveCell("")).toBe(true);
    expect(parseActiveCell("Nonaktif")).toBe(false);
    expect(parseActiveCell("active")).toBe(true);
  });

  it("stringifies sheet cells", () => {
    expect(spreadsheetCell(null)).toBe("");
    expect(spreadsheetCell(12.5)).toBe("12.5");
    expect(spreadsheetCell(" a ")).toBe("a");
  });

  it("increments the trailing sequence of the last code", () => {
    expect(nextCodeSequence("BHN-2026-0007")).toBe(8);
    expect(nextCodeSequence(null)).toBe(1);
    expect(nextCodeSequence("SUP-2026-x")).toBe(1);
  });
});

describe("ImportTally", () => {
  it("counts skips with their messages", () => {
    const tally = new ImportTally();
    tally.imported += 2;
    tally.skip(3, "gagal");
    expect(tally.summary()).toEqual({
      success: true,
      imported: 2,
      updated: 0,
      skipped: 1,
      errors: [{ row: 3, message: "gagal" }],
    });
  });
});
