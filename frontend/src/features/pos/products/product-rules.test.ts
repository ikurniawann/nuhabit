import { describe, expect, it } from "vitest";
import {
  addAxisValues,
  DEFAULT_MATRIX_AXES,
  filterProducts,
  inferStation,
  formatMarginLabel,
  marginTone,
  matrixResultMessage,
  merchStockLabel,
  parseBonusXp,
  parseMatrixPrice,
  parseMinXp,
  productCategories,
  removeSkuRow,
  skuRowPayload,
  splitChipDraft,
  validateMerchSettings,
  type MerchSkuRow,
} from "./product-rules";
import type { PosCatalogProduct } from "./types";

const product = (over: Partial<PosCatalogProduct> = {}): PosCatalogProduct => ({
  id: "p1",
  name: "Es Kopi Susu",
  category: "Minuman",
  price: 25000,
  cost: 9000,
  margin: 64,
  status: "active",
  station: "",
  hasVariants: false,
  hasModifiers: false,
  variants: [],
  modifierGroups: [],
  minXp: null,
  bonusXp: 0,
  productKind: "regular",
  sourceProductId: null,
  inventoryTracking: false,
  inventoryQuantity: 7,
  weightGram: null,
  sizeGuide: null,
  merchSkus: [],
  webDistributed: false,
  salesChannels: null,
  ...over,
});

const row = (over: Partial<MerchSkuRow> = {}): MerchSkuRow => ({
  rowId: "r1",
  sku: "KAOS-L",
  name: "L",
  barcode: "",
  stock: "3",
  price: "",
  active: true,
  ...over,
});

describe("katalog", () => {
  it("kategori unik diawali All, filter nama/SKU + kategori", () => {
    const list = [product(), product({ id: "p2", name: "Roti", sku: "RT-1", category: "Bakery" })];
    expect(productCategories(list)).toEqual(["All", "Minuman", "Bakery"]);
    expect(filterProducts(list, "rt-1", "All").map((p) => p.id)).toEqual(["p2"]);
    expect(filterProducts(list, "", "Minuman").map((p) => p.id)).toEqual(["p1"]);
  });

  it("station eksplisit menang, selain itu ditebak dari nama/kategori", () => {
    expect(inferStation(product({ station: "dessert" }))).toBe("dessert");
    expect(inferStation(product())).toBe("bar");
    expect(inferStation(product({ name: "Croissant", category: "Pastry" }))).toBe("bakery");
    expect(inferStation(product({ name: "Nasi Goreng", category: "Makanan" }))).toBe("kitchen");
  });

  it("stok merchandise = jumlah stok SKU aktif bila ada", () => {
    expect(merchStockLabel(product())).toBe(7);
    const skus = [
      { id: "a", sku: "a", name: "a", barcode: null, priceOverride: null, stock: 2, active: true },
      { id: "b", sku: "b", name: "b", barcode: null, priceOverride: null, stock: 5, active: false },
    ];
    expect(merchStockLabel(product({ merchSkus: skus }))).toBe(2);
  });

  it("label & warna margin, parsing XP", () => {
    expect(formatMarginLabel(12.345)).toBe("12.35%");
    expect(formatMarginLabel(40)).toBe("40%");
    expect([marginTone(-1), marginTone(10), marginTone(30)]).toEqual(["text-red-600", "text-amber-600", "text-green-600"]);
    expect(parseMinXp("")).toBeNull();
    expect(parseMinXp("0")).toBeNull();
    expect(parseMinXp("12.7")).toBe(12);
    expect(parseBonusXp("-3")).toBe(0);
    expect(parseBonusXp("4.9")).toBe(4);
  });
});

describe("varian SKU merchandise", () => {
  it("hapus baris tersimpan = ditandai, baris baru = dibuang", () => {
    const rows = [row({ rowId: "saved", id: "s1" }), row({ rowId: "new" })];
    expect(removeSkuRow(rows, "saved")).toEqual([{ ...rows[0], deleted: true }, rows[1]]);
    expect(removeSkuRow(rows, "new")).toEqual([rows[0]]);
  });

  it("payload: trim, barcode kosong = null, harga kosong = null", () => {
    expect(skuRowPayload(row({ sku: " A ", name: " B ", price: "15000" }))).toEqual({
      sku: "A",
      name: "B",
      barcode: null,
      price_override: 15000,
      stock_quantity: 3,
      is_active: true,
    });
  });

  it("validasi stok, berat, dan baris varian", () => {
    const form = { sourceProductId: "", stock: "5", weightGram: "", webDistributed: false };
    expect(validateMerchSettings(form, [])).toEqual({ ok: true, stock: 5, weightGram: null });
    expect(validateMerchSettings({ ...form, stock: "-1" }, [])).toEqual({ ok: false, error: "Stok harus angka ≥ 0" });
    expect(validateMerchSettings({ ...form, weightGram: "x" }, [])).toMatchObject({ ok: false });
    expect(validateMerchSettings(form, [row({ sku: "" })])).toMatchObject({ error: "Setiap varian wajib punya kode SKU dan nama" });
    expect(validateMerchSettings(form, [row({ sku: "", deleted: true, id: "x" })])).toMatchObject({ ok: true });
    expect(validateMerchSettings(form, [row({ stock: "abc" })])).toMatchObject({ error: "Stok varian L harus angka" });
  });
});

describe("matriks varian", () => {
  it("nilai koma ditambahkan tanpa duplikat (abaikan huruf besar)", () => {
    const axes = addAxisValues(DEFAULT_MATRIX_AXES, "ukuran", "S, m ,M,, L");
    expect(axes[0]?.values).toEqual(["S", "m", "L"]);
    expect(addAxisValues(axes, "ukuran", " , ")).toBe(axes);
  });

  it("draf chip: bagian sebelum koma terakhir di-commit", () => {
    expect(splitChipDraft("S,M,L")).toEqual({ commit: "S,M", draft: "L" });
    expect(splitChipDraft("XL")).toEqual({ commit: "", draft: "XL" });
  });

  it("harga override & pesan hasil", () => {
    expect(parseMatrixPrice("")).toEqual({ ok: true, value: null });
    expect(parseMatrixPrice("-5")).toEqual({ ok: false });
    expect(matrixResultMessage({ created: [1, 2], reactivated: [], deactivated: [1], kept: [] })).toBe(
      "2 SKU dibuat, 1 dinonaktifkan, 0 tidak berubah"
    );
    expect(matrixResultMessage({ created: [], reactivated: [1], deactivated: [], kept: [1] })).toBe(
      "0 SKU dibuat, 1 diaktifkan kembali, 0 dinonaktifkan, 1 tidak berubah"
    );
  });
});
