import { describe, expect, test } from "vitest";
import { terbilangRupiah } from "./terbilang";

describe("terbilangRupiah", () => {
  test("angka satuan dan belasan", () => {
    expect(terbilangRupiah(1)).toBe("satu rupiah");
    expect(terbilangRupiah(11)).toBe("sebelas rupiah");
    expect(terbilangRupiah(17)).toBe("tujuh belas rupiah");
  });

  test("puluhan dan ratusan (termasuk seratus khusus)", () => {
    expect(terbilangRupiah(45)).toBe("empat puluh lima rupiah");
    expect(terbilangRupiah(100)).toBe("seratus rupiah");
    expect(terbilangRupiah(250)).toBe("dua ratus lima puluh rupiah");
  });

  test("ribuan (termasuk seribu khusus)", () => {
    expect(terbilangRupiah(1000)).toBe("seribu rupiah");
    expect(terbilangRupiah(4500)).toBe("empat ribu lima ratus rupiah");
  });

  test("gaji umum: juta", () => {
    expect(terbilangRupiah(4_500_000)).toBe("empat juta lima ratus ribu rupiah");
    expect(terbilangRupiah(12_750_000)).toBe(
      "dua belas juta tujuh ratus lima puluh ribu rupiah"
    );
  });

  test("miliar", () => {
    expect(terbilangRupiah(1_000_000_000)).toBe("satu miliar rupiah");
  });

  test("nol, negatif, dan tidak valid", () => {
    expect(terbilangRupiah(0)).toBe("nol rupiah");
    expect(terbilangRupiah(-5)).toBe("nol rupiah");
    expect(terbilangRupiah(NaN)).toBe("nol rupiah");
  });
});
