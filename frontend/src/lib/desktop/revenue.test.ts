import { describe, expect, it } from "vitest";

import { breakdownRevenue, promoEfficiency, type RevenueSource } from "./revenue";

/**
 * Tes ditulis lebih dulu (EPIC-037 Fase B).
 *
 * Yang dijaga di sini bukan aritmetikanya — melainkan cara angka disajikan saat
 * datanya belum ada. Papan owner paling mudah menyesatkan justru ketika sepi:
 * porsi 0/0 yang jadi NaN, atau efisiensi promo yang tampak tak terhingga.
 */

const sumber = (fnb: number, b2b: number): RevenueSource[] => [
  { kunci: "fnb", label: "F&B", nilai: fnb },
  { kunci: "b2b", label: "B2B", nilai: b2b },
];

describe("breakdownRevenue", () => {
  it("menjumlahkan sumber dan menghitung porsinya", () => {
    const hasil = breakdownRevenue(sumber(7_500_000, 2_500_000));

    expect(hasil.total).toBe(10_000_000);
    expect(hasil.sumber.map((s) => s.porsi)).toEqual([75, 25]);
  });

  it("porsi dibulatkan tapi tetap berjumlah 100 saat pembulatan bentrok", () => {
    // 1/3 : 1/3 : 1/3 → 33+33+33 = 99. Owner yang menjumlahkan sendiri akan
    // menganggap ada yang hilang, jadi selisihnya dititipkan ke porsi terbesar.
    const hasil = breakdownRevenue([
      { kunci: "fnb", label: "A", nilai: 100 },
      { kunci: "b2b", label: "B", nilai: 100 },
      { kunci: "lain", label: "C", nilai: 100 },
    ]);

    expect(hasil.sumber.reduce((a, s) => a + s.porsi, 0)).toBe(100);
  });

  it("total nol tidak menghasilkan NaN", () => {
    const hasil = breakdownRevenue(sumber(0, 0));

    expect(hasil.total).toBe(0);
    expect(hasil.sumber.every((s) => s.porsi === 0)).toBe(true);
  });

  it("mengabaikan sumber bernilai nol dari daftar tampil, tapi tidak dari total", () => {
    const hasil = breakdownRevenue(sumber(1_000_000, 0));

    expect(hasil.total).toBe(1_000_000);
    expect(hasil.sumber).toHaveLength(1);
    expect(hasil.sumber[0].kunci).toBe("fnb");
  });

  it("nilai negatif (refund melebihi penjualan) tidak merusak porsi", () => {
    const hasil = breakdownRevenue(sumber(1_000_000, -1_500_000));

    expect(hasil.total).toBe(-500_000);
    // Porsi dari total negatif tidak punya arti — dikembalikan 0, bukan angka
    // menyesatkan seperti -200%.
    expect(hasil.sumber.every((s) => s.porsi === 0)).toBe(true);
  });
});

describe("promoEfficiency", () => {
  it("menghitung rupiah omzet per rupiah diskon", () => {
    expect(promoEfficiency(1_000_000, 8_000_000)).toBe(8);
  });

  it("diskon nol → null, bukan Infinity", () => {
    // Tanpa penjaga ini kartu promo menampilkan "∞x" saat belum ada promo dipakai.
    expect(promoEfficiency(0, 5_000_000)).toBeNull();
  });

  it("omzet nol dengan diskon berjalan → 0, bukan null", () => {
    // Ini kondisi nyata dan buruk: diskon keluar tapi tidak membawa penjualan.
    // Harus terbaca sebagai 0, bukan disembunyikan seperti 'tidak ada data'.
    expect(promoEfficiency(500_000, 0)).toBe(0);
  });

  it("dibulatkan dua desimal supaya terbaca", () => {
    expect(promoEfficiency(300_000, 1_000_000)).toBe(3.33);
  });
});
