import { describe, expect, it } from "vitest";
import {
  requiresVariantSplit,
  splitEvenly,
  validateVariantSplit,
  type ActiveSku,
} from "./variant-output";

const activeSkus: ActiveSku[] = [
  { id: "sku-s", sku: "KAOS-001-S-HTM", name: "Kaos — S / Hitam" },
  { id: "sku-m", sku: "KAOS-001-M-HTM", name: "Kaos — M / Hitam" },
  { id: "sku-l", sku: "KAOS-001-L-HTM", name: "Kaos — L / Hitam" },
  { id: "sku-xl", sku: "KAOS-001-XL-HTM", name: "Kaos — XL / Hitam" },
];

describe("validateVariantSplit", () => {
  it("happy path: jumlah split sama persis dengan actual_qty", () => {
    const result = validateVariantSplit(
      100,
      [
        { pos_sku_id: "sku-s", qty: 20 },
        { pos_sku_id: "sku-m", qty: 30 },
        { pos_sku_id: "sku-l", qty: 30 },
        { pos_sku_id: "sku-xl", qty: 20 },
      ],
      activeSkus
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        { pos_sku_id: "sku-s", qty: 20 },
        { pos_sku_id: "sku-m", qty: 30 },
        { pos_sku_id: "sku-l", qty: 30 },
        { pos_sku_id: "sku-xl", qty: 20 },
      ]);
    }
  });

  it("toleransi 2 desimal untuk floating point (0.1 + 0.2 dst.)", () => {
    const result = validateVariantSplit(
      1,
      [
        { pos_sku_id: "sku-s", qty: 0.1 },
        { pos_sku_id: "sku-m", qty: 0.2 },
        { pos_sku_id: "sku-l", qty: 0.7 },
      ],
      activeSkus
    );
    expect(result.ok).toBe(true);
  });

  it("jumlah tidak sama dengan actual_qty → error menyebut kedua angka", () => {
    const result = validateVariantSplit(
      100,
      [
        { pos_sku_id: "sku-s", qty: 20 },
        { pos_sku_id: "sku-m", qty: 30 },
        { pos_sku_id: "sku-l", qty: 30 },
        { pos_sku_id: "sku-xl", qty: 10 },
      ],
      activeSkus
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("90");
      expect(result.error).toContain("100");
      expect(result.error).toBe(
        "Rincian varian harus berjumlah sama dengan jumlah aktual (90 vs 100)"
      );
    }
  });

  it("pos_sku_id tidak dikenal / tidak aktif → error", () => {
    const result = validateVariantSplit(
      100,
      [{ pos_sku_id: "sku-tidak-ada", qty: 100 }],
      activeSkus
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Varian tidak dikenal / tidak aktif");
  });

  it("pos_sku_id duplikat → error", () => {
    const result = validateVariantSplit(
      100,
      [
        { pos_sku_id: "sku-s", qty: 50 },
        { pos_sku_id: "sku-s", qty: 50 },
      ],
      activeSkus
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Varian ganda");
  });

  it("qty <= 0 → error", () => {
    const result = validateVariantSplit(100, [{ pos_sku_id: "sku-s", qty: 0 }], activeSkus);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Qty varian harus > 0");
  });

  it("qty negatif → error", () => {
    const result = validateVariantSplit(100, [{ pos_sku_id: "sku-s", qty: -5 }], activeSkus);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Qty varian harus > 0");
  });

  it("qty bukan angka valid (NaN) → error", () => {
    const result = validateVariantSplit(
      100,
      [{ pos_sku_id: "sku-s", qty: Number.NaN }],
      activeSkus
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Qty varian harus > 0");
  });

  it("rows kosong / tidak dikirim → error", () => {
    const empty = validateVariantSplit(100, [], activeSkus);
    expect(empty.ok).toBe(false);
    const missing = validateVariantSplit(100, null, activeSkus);
    expect(missing.ok).toBe(false);
  });
});

describe("requiresVariantSplit", () => {
  it("true kalau ada SKU aktif", () => {
    expect(requiresVariantSplit(activeSkus)).toBe(true);
  });

  it("false kalau daftar SKU kosong (produk tanpa matriks varian / bukan merchandise)", () => {
    expect(requiresVariantSplit([])).toBe(false);
  });

  it("false kalau null/undefined (produk tanpa link POS merchandise)", () => {
    expect(requiresVariantSplit(null)).toBe(false);
    expect(requiresVariantSplit(undefined)).toBe(false);
  });
});

describe("splitEvenly", () => {
  it("100 dibagi 3 baris → jumlah tetap 100.00 persis, sisa ke baris pertama", () => {
    const rows = splitEvenly(100, ["a", "b", "c"]);
    const sum = rows.reduce((acc, row) => acc + row.qty, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
    expect(rows).toEqual([
      { pos_sku_id: "a", qty: 33.34 },
      { pos_sku_id: "b", qty: 33.33 },
      { pos_sku_id: "c", qty: 33.33 },
    ]);
  });

  it("7 dibagi 4 baris → jumlah tetap 7.00 persis", () => {
    const rows = splitEvenly(7, ["a", "b", "c", "d"]);
    const sum = rows.reduce((acc, row) => acc + row.qty, 0);
    expect(Math.round(sum * 100) / 100).toBe(7);
    expect(rows).toEqual([
      { pos_sku_id: "a", qty: 1.75 },
      { pos_sku_id: "b", qty: 1.75 },
      { pos_sku_id: "c", qty: 1.75 },
      { pos_sku_id: "d", qty: 1.75 },
    ]);
  });

  it("100 dibagi 4 baris habis rata (25 masing-masing)", () => {
    const rows = splitEvenly(100, ["a", "b", "c", "d"]);
    expect(rows).toEqual([
      { pos_sku_id: "a", qty: 25 },
      { pos_sku_id: "b", qty: 25 },
      { pos_sku_id: "c", qty: 25 },
      { pos_sku_id: "d", qty: 25 },
    ]);
  });

  it("daftar SKU kosong → hasil kosong", () => {
    expect(splitEvenly(100, [])).toEqual([]);
  });

  it("hasil validateVariantSplit(splitEvenly(...)) selalu valid untuk kombinasi acak", () => {
    const cases: Array<[number, number]> = [
      [100, 3],
      [101, 7],
      [1, 4],
      [999, 13],
    ];
    for (const [qty, n] of cases) {
      const ids = Array.from({ length: n }, (_, i) => `sku-${i}`);
      const skus: ActiveSku[] = ids.map((id) => ({ id, sku: id, name: id }));
      const rows = splitEvenly(qty, ids);
      const result = validateVariantSplit(qty, rows, skus);
      expect(result.ok).toBe(true);
    }
  });
});
