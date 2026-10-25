import { describe, expect, it } from "vitest";
import { summarize, writableRows, type ImportReport } from "./api";

const report = (over: Partial<ImportReport>): ImportReport => ({
  dry_run: true,
  total: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
  rows: [],
  errors: [],
  ...over,
});

describe("summarize", () => {
  it("lists only the non-zero counts in order", () => {
    expect(summarize(report({ total: 6, created: 3, unchanged: 2, failed: 1 }))).toBe("3 baru, 2 tidak berubah, 1 gagal");
  });

  it("names an empty report", () => {
    expect(summarize(report({}))).toBe("Tidak ada baris");
  });
});

describe("writableRows", () => {
  it("counts the rows a commit would write", () => {
    expect(writableRows(report({ created: 2, updated: 1, unchanged: 5, failed: 1 }))).toBe(3);
  });
});
