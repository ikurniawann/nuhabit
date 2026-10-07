import { describe, expect, it } from "vitest";
import { parseSalesTarget, sanitizeSalesTargetInput } from "./sales-target";

describe("parseSalesTarget", () => {
  it("null dan JSON rusak jatuh ke 0/0 tanpa meledak", () => {
    expect(parseSalesTarget(null)).toEqual({ harianRp: 0, bulananRp: 0 });
    expect(parseSalesTarget("{rusak")).toEqual({ harianRp: 0, bulananRp: 0 });
  });

  it("membaca nilai tersimpan", () => {
    expect(parseSalesTarget('{"harianRp":5000000,"bulananRp":120000000}')).toEqual({
      harianRp: 5_000_000,
      bulananRp: 120_000_000,
    });
  });

  it("nilai janggal per-field jatuh ke default tanpa merusak field lain", () => {
    expect(parseSalesTarget('{"harianRp":-1,"bulananRp":3000000}')).toEqual({
      harianRp: 0,
      bulananRp: 3_000_000,
    });
  });
});

describe("sanitizeSalesTargetInput", () => {
  it("menerima string berformat rupiah", () => {
    expect(sanitizeSalesTargetInput({ harianRp: "5.000.000" })).toEqual({ harianRp: 5_000_000 });
  });

  it("menolak nilai bukan angka dan plafon tak waras", () => {
    expect(sanitizeSalesTargetInput({ harianRp: "abc" })).toBeNull();
    // 1 triliun = salah ketik nol, tolak daripada menampilkan 0,0001% selamanya
    expect(sanitizeSalesTargetInput({ bulananRp: 1_000_000_000_000 })).toBeNull();
  });

  it("PUT parsial: field yang tidak dikirim tidak tersentuh", () => {
    expect(sanitizeSalesTargetInput({ bulananRp: 90_000_000 })).toEqual({ bulananRp: 90_000_000 });
  });

  it("nol berarti menghapus target — sah", () => {
    expect(sanitizeSalesTargetInput({ harianRp: 0 })).toEqual({ harianRp: 0 });
  });
});
