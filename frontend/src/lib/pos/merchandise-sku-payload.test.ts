import { describe, expect, it } from "vitest";
import { isUniqueViolation, normalizeSkuPayload } from "./merchandise-sku-payload";

describe("normalizeSkuPayload", () => {
  it("sku & name wajib saat requireCore", () => {
    expect(normalizeSkuPayload({}, { requireCore: true })).toEqual({
      ok: false,
      error: "Kode SKU wajib diisi",
    });
    expect(normalizeSkuPayload({ sku: "SKU-1" }, { requireCore: true })).toEqual({
      ok: false,
      error: "Nama varian wajib diisi",
    });
  });

  it("sku > 60 karakter ditolak", () => {
    expect(
      normalizeSkuPayload({ sku: "S".repeat(61), name: "Nama" }, { requireCore: true })
    ).toEqual({ ok: false, error: "Kode SKU maksimal 60 karakter" });
  });

  it("name > 120 karakter ditolak", () => {
    expect(
      normalizeSkuPayload({ sku: "SKU-1", name: "N".repeat(121) }, { requireCore: true })
    ).toEqual({ ok: false, error: "Nama varian maksimal 120 karakter" });
  });

  it("barcode tepat 64 karakter — ok", () => {
    const barcode = "B".repeat(64);
    const result = normalizeSkuPayload({ barcode });
    expect(result).toEqual({ ok: true, columns: { barcode } });
  });

  it("barcode 65 karakter — ditolak (F2)", () => {
    expect(normalizeSkuPayload({ barcode: "B".repeat(65) })).toEqual({
      ok: false,
      error: "Barcode maksimal 64 karakter",
    });
  });

  it("barcode kosong/undefined tidak divalidasi panjangnya, disimpan null", () => {
    expect(normalizeSkuPayload({ barcode: "" })).toEqual({ ok: true, columns: { barcode: null } });
    expect(normalizeSkuPayload({})).toEqual({ ok: true, columns: {} });
  });

  it("price_override harus angka >= 0", () => {
    expect(normalizeSkuPayload({ price_override: -1 })).toEqual({
      ok: false,
      error: "Harga varian harus angka ≥ 0",
    });
    expect(normalizeSkuPayload({ price_override: 1000 })).toEqual({
      ok: true,
      columns: { price_override: 1000 },
    });
    expect(normalizeSkuPayload({ price_override: null })).toEqual({
      ok: true,
      columns: { price_override: null },
    });
  });

  it("stock_quantity harus angka", () => {
    expect(normalizeSkuPayload({ stock_quantity: "abc" })).toEqual({
      ok: false,
      error: "Stok varian harus angka",
    });
    expect(normalizeSkuPayload({ stock_quantity: "5" })).toEqual({
      ok: true,
      columns: { stock_quantity: 5 },
    });
  });
});

describe("isUniqueViolation", () => {
  it("true untuk kode postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("true untuk pesan yang mengandung duplicate key / unique", () => {
    expect(isUniqueViolation({ message: "duplicate key value violates unique constraint" })).toBe(
      true
    );
  });

  it("false untuk error lain", () => {
    expect(isUniqueViolation({ code: "23502", message: "not null violation" })).toBe(false);
  });
});
