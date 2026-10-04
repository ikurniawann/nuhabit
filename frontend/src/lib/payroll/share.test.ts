import { describe, it, expect } from "vitest";
import { formatShareOfGross } from "./share";

describe("formatShareOfGross", () => {
  it("menghitung porsi terhadap bruto dengan satu desimal", () => {
    expect(formatShareOfGross(208_280, 11_450_000)).toBe("1,8%");
    expect(formatShareOfGross(1_666_667, 11_450_000)).toBe("14,6%");
    expect(formatShareOfGross(2_710_262, 11_450_000)).toBe("23,7%");
  });

  it("mengembalikan null saat tidak bermakna", () => {
    expect(formatShareOfGross(100, 0)).toBeNull();      // bruto nol
    expect(formatShareOfGross(100, -5)).toBeNull();     // bruto negatif
    expect(formatShareOfGross(0, 11_450_000)).toBeNull(); // potongan nol
  });

  it("tidak menampilkan 0,0% untuk nilai sangat kecil", () => {
    // Rp 100 dari Rp 11,45 juta = 0,00087% — dibulatkan jadi "0,0%" dan
    // terbaca seolah tidak ada potongan sama sekali.
    expect(formatShareOfGross(100, 11_450_000)).toBe("<0,1%");
  });

  it("memakai nilai mutlak agar potongan bertanda minus tetap benar", () => {
    expect(formatShareOfGross(-208_280, 11_450_000)).toBe("1,8%");
  });

  it("tahan terhadap angka tidak valid", () => {
    expect(formatShareOfGross(Number.NaN, 100)).toBeNull();
    expect(formatShareOfGross(100, Number.NaN)).toBeNull();
    expect(formatShareOfGross(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("menangani potongan yang melebihi bruto tanpa pembatasan aneh", () => {
    expect(formatShareOfGross(12_000_000, 10_000_000)).toBe("120,0%");
  });
});
