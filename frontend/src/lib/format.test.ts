import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  formatNumber,
  formatRupiah,
  formatRupiahCompact,
  formatTime,
} from "./format";

describe("formatRupiah", () => {
  it("PUEBI tanpa spasi, dibulatkan, negatif di depan", () => {
    expect(formatRupiah(1250000)).toBe("Rp1.250.000");
    expect(formatRupiah("1500.6")).toBe("Rp1.501");
    expect(formatRupiah(-2000)).toBe("-Rp2.000");
    expect(formatRupiah(null)).toBe("Rp0");
    expect(formatRupiah("abc")).toBe("Rp0");
  });
});

describe("formatRupiahCompact", () => {
  it("rb, jt, M dengan desimal koma", () => {
    expect(formatRupiahCompact(950)).toBe("Rp950");
    expect(formatRupiahCompact(165_000)).toBe("Rp165 rb");
    expect(formatRupiahCompact(1_250_000)).toBe("Rp1,25 jt");
    expect(formatRupiahCompact(2_500_000_000)).toBe("Rp2,5 M");
    expect(formatRupiahCompact(-165_000)).toBe("-Rp165 rb");
  });
});

describe("formatNumber", () => {
  it("pemisah ribuan titik, desimal opsional", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(12.345, 2)).toBe("12,35");
  });
});

describe("tanggal & jam WIB", () => {
  const instant = "2026-10-03T17:30:00Z"; // 4 Okt 2026 00.30 WIB

  it("instan UTC ditampilkan dalam WIB", () => {
    expect(formatDate(instant)).toBe("4 Okt 2026");
    expect(formatTime(instant)).toBe("00.30");
    expect(formatDateTime(instant)).toBe("4 Okt 2026, 00.30");
  });

  it("tanggal kalender tidak bergeser", () => {
    expect(formatDate("2026-08-01")).toBe("1 Agu 2026");
    expect(formatDateLong("2026-10-04")).toBe("Minggu, 4 Oktober 2026");
  });

  it("nilai kosong/tidak valid memakai fallback", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("bukan tanggal", "")).toBe("");
  });
});
