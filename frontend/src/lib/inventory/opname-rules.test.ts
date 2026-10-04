import { describe, expect, it } from "vitest";
import {
  assertOpnameCompletable,
  assertOpnameEditable,
  countedLineValues,
  opnameListPagination,
  summarizeOpnameCounts,
  toQty,
} from "./opname-rules";

describe("toQty", () => {
  it("angka dari teks numeric; NaN dan null jadi 0", () => {
    expect([toQty("12.5"), toQty(null), toQty("abc"), toQty(3)]).toEqual([12.5, 0, 0, 3]);
  });
});

describe("assertOpnameEditable", () => {
  it("menolak opname selesai atau batal", () => {
    expect(() => assertOpnameEditable({ status: "completed" })).toThrow("sudah selesai");
    expect(() => assertOpnameEditable({ status: "cancelled" })).toThrow("dibatalkan");
    expect(() => assertOpnameEditable({ status: "in_progress" })).not.toThrow();
  });
});

describe("assertOpnameCompletable", () => {
  it("menolak baris yang belum dihitung dengan jumlahnya", () => {
    expect(() =>
      assertOpnameCompletable({ status: "in_progress", lines: [{ qty_counted: 1 }, { qty_counted: null }, {}] })
    ).toThrow("Masih ada 2 baris yang belum dihitung");
  });

  it("menolak opname selesai/batal, lolos bila semua terhitung", () => {
    expect(() => assertOpnameCompletable({ status: "completed", lines: [] })).toThrow("sudah diselesaikan");
    expect(() => assertOpnameCompletable({ status: "cancelled", lines: [] })).toThrow("tidak dapat diselesaikan");
    expect(() => assertOpnameCompletable({ status: "draft", lines: [{ qty_counted: 0 }] })).not.toThrow();
  });
});

describe("countedLineValues", () => {
  it("selisih = hitung - sistem; null tetap null", () => {
    expect(countedLineValues(8, 10)).toEqual({ qty_counted: 8, qty_variance: -2 });
    expect(countedLineValues(null, 10)).toEqual({ qty_counted: null, qty_variance: null });
  });
});

describe("summarizeOpnameCounts", () => {
  it("draft pindah ke in_progress begitu ada baris terhitung", () => {
    const lines = [
      { qty_counted: 5, qty_variance: 0 },
      { qty_counted: 3, qty_variance: -1 },
      { qty_counted: null, qty_variance: null },
    ];
    expect(summarizeOpnameCounts("draft", lines)).toEqual({
      lines_counted: 2,
      lines_with_variance: 1,
      status: "in_progress",
    });
    expect(summarizeOpnameCounts("draft", [{ qty_counted: null }]).status).toBe("draft");
  });
});

describe("opnameListPagination", () => {
  it("minimal satu halaman", () => {
    expect(opnameListPagination(1, 20, 0).total_pages).toBe(1);
    expect(opnameListPagination(2, 20, 41)).toEqual({ page: 2, limit: 20, total: 41, total_pages: 3 });
  });
});
