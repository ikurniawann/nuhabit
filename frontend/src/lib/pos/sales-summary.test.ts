import { describe, expect, it } from "vitest";

import {
  aggregatePerStall,
  summarizeSales,
  type SalesRow,
} from "./sales-summary";

/**
 * Tes ditulis lebih dulu (laporan transaksi POS — permintaan owner:
 * Revenue, Diskon, Pajak → Nett, plus rekap per stall).
 *
 * Definisi yang dikunci di sini:
 *   Revenue = jumlah subtotal (harga barang SEBELUM diskon/pajak/service)
 *   Nett    = jumlah total_amount (yang benar-benar dibayar pelanggan)
 * sehingga identitas Revenue − Diskon + Pajak + Service = Nett bisa diperiksa
 * pembaca laporan sendiri. Kalau data historis tidak memenuhi identitas itu
 * (mis. order lama tanpa subtotal), Nett tetap dari total_amount — angka uang
 * masuk adalah fakta, turunannya yang menyesuaikan.
 */

const row = (over: Partial<SalesRow> = {}): SalesRow => ({
  subtotal: 100_000,
  discount_amount: 10_000,
  tax_amount: 9_000,
  service_charge_amount: 5_000,
  total_amount: 104_000,
  ark_coins_used: 0,
  stall_code: "STALL-01",
  stall_name: "Main",
  ...over,
});

describe("summarizeSales", () => {
  it("menjumlahkan revenue, diskon, pajak, service, dan nett", () => {
    const s = summarizeSales([row(), row()]);
    expect(s).toMatchObject({
      transactions: 2,
      revenue: 200_000,
      discount: 20_000,
      tax: 18_000,
      service: 10_000,
      nett: 208_000,
    });
  });

  it("nett diambil dari total_amount, bukan dihitung ulang — uang masuk adalah fakta", () => {
    // Order lama yang subtotal-nya kosong tidak boleh membuat nett salah.
    const s = summarizeSales([row({ subtotal: 0, total_amount: 104_000 })]);
    expect(s.nett).toBe(104_000);
    expect(s.revenue).toBe(0);
  });

  it("daftar kosong → semua nol, bukan NaN", () => {
    const s = summarizeSales([]);
    expect(s).toMatchObject({ transactions: 0, revenue: 0, discount: 0, nett: 0 });
  });

  it("nilai string dari driver pg tetap terhitung", () => {
    const s = summarizeSales([
      row({ subtotal: "50000" as unknown as number, total_amount: "55000" as unknown as number }),
    ]);
    expect(s.revenue).toBe(50_000);
    expect(s.nett).toBe(55_000);
  });
});

describe("aggregatePerStall", () => {
  it("mengelompokkan per stall dengan ringkasan masing-masing", () => {
    const hasil = aggregatePerStall([
      row({ stall_name: "Hikiniku", stall_code: "STALL-02", total_amount: 50_000, subtotal: 50_000, discount_amount: 0, tax_amount: 0, service_charge_amount: 0 }),
      row({ stall_name: "Hikiniku", stall_code: "STALL-02", total_amount: 30_000, subtotal: 30_000, discount_amount: 0, tax_amount: 0, service_charge_amount: 0 }),
      row({ stall_name: "Noodles", stall_code: "STALL-03" }),
    ]);

    expect(hasil).toHaveLength(2);
    const hikiniku = hasil.find((s) => s.stall_code === "STALL-02");
    expect(hikiniku).toMatchObject({ transactions: 2, nett: 80_000 });
    // Urut nett terbesar dulu — stall teratas yang paling ingin dilihat owner.
    expect(hasil[0].stall_name).toBe("Noodles");
  });

  it("order tanpa stall dikelompokkan sebagai 'Tanpa Stall', bukan hilang", () => {
    const hasil = aggregatePerStall([row({ stall_code: null, stall_name: null })]);
    expect(hasil[0].stall_name).toBe("Tanpa Stall");
    expect(hasil[0].transactions).toBe(1);
  });
});
