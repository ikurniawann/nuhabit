import { describe, expect, it } from "vitest";
import { buildProductPayload, normalizeOutputType } from "./import-products";
import {
  buildUnitConversions,
  missingRawMaterialFields,
  normalizeKategori,
  readRawMaterialRow,
  unitCostForStock,
} from "./import-raw-materials";
import {
  buildSupplierPayload,
  normalizeCurrency,
  normalizePaymentTerms,
  normalizeSupplierStatus,
} from "./import-suppliers";
import { buildUnitPayload } from "./import-units";

describe("raw material import rules", () => {
  it("reads a row and validates the COA", () => {
    const fields = readRawMaterialRow({
      nama: " Gula ",
      kategori: "bumbu",
      satuan_besar_kode: "SACK",
      konversi_factor: "50",
      harga_beli: "500,000",
      coa: "rnd",
      opening_stock: "0",
      status: "inactive",
    });
    expect(fields).toMatchObject({
      nama: "Gula",
      coa: "RND",
      konversiFactor: 50,
      hargaBeli: 500000,
      hasStockValue: true,
      stockQty: 0,
      payload: { is_active: false, stok_minimum: 0, shelf_life_days: null },
    });
    expect(readRawMaterialRow({ coa: "OPEX" }).coa).toBeNull();
    expect(readRawMaterialRow({ opening_stock: " " }).hasStockValue).toBe(false);
  });

  it("lists missing required fields", () => {
    expect(missingRawMaterialFields(readRawMaterialRow({ nama: "x" }))).toEqual([
      "satuan_besar_kode",
      "kategori",
    ]);
  });

  it("normalises category codes", () => {
    expect(normalizeKategori(" bahan kering ")).toBe("BAHAN_KERING");
  });

  it("divides cost by the conversion factor only with a small unit", () => {
    expect(unitCostForStock(500000, 50, true)).toBe(10000);
    expect(unitCostForStock(500000, 50, false)).toBe(500000);
    expect(unitCostForStock(500000, 0, true)).toBe(500000);
  });

  it("builds base + purchase unit conversions without duplicates", () => {
    expect(buildUnitConversions({ satuan_besar_id: "sack", satuan_kecil_id: "kg", konversi_factor: 50 })).toEqual([
      { satuan_id: "kg", qty_in_base_unit: 1, is_base: true },
      { satuan_id: "sack", qty_in_base_unit: 50, is_base: false },
    ]);
    expect(buildUnitConversions({ satuan_besar_id: "kg", satuan_kecil_id: "kg", konversi_factor: 1 })).toEqual([
      { satuan_id: "kg", qty_in_base_unit: 1, is_base: true },
    ]);
    expect(buildUnitConversions({ satuan_besar_id: "pcs", satuan_kecil_id: null, konversi_factor: 9 })).toEqual([
      { satuan_id: "pcs", qty_in_base_unit: 1, is_base: true },
    ]);
  });
});

describe("product import rules", () => {
  it("maps output type", () => {
    expect(normalizeOutputType("work in progress")).toBe("WIP");
    expect(normalizeOutputType("")).toBe("FINISHED_GOOD");
    expect(normalizeOutputType("other")).toBe("FINISHED_GOOD");
  });

  it("builds the product payload with defaults", () => {
    expect(buildProductPayload({ nama: " Kaos ", kategori: "merch", status: "no" }, "unit-1")).toEqual({
      nama: "Kaos",
      kategori: "MERCH",
      satuan_id: "unit-1",
      deskripsi: null,
      harga_jual: 0,
      harga_modal: 0,
      markup_persen: 30,
      production_output_type: "FINISHED_GOOD",
      is_active: false,
    });
  });
});

describe("supplier import rules", () => {
  it("normalises payment terms, currency and status", () => {
    expect(normalizePaymentTerms("cash")).toBe("CBD");
    expect(normalizePaymentTerms("")).toBe("TOP30");
    expect(normalizePaymentTerms("weird")).toBe("TOP30");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("xyz")).toBe("IDR");
    expect(normalizeSupplierStatus("Blocked")).toBe("blocked");
    expect(normalizeSupplierStatus("0")).toBe("inactive");
    expect(normalizeSupplierStatus("aktif")).toBe("active");
  });

  it("marks blocked suppliers inactive", () => {
    expect(buildSupplierPayload({ status: "blocked", email: " " }, "Toko A")).toMatchObject({
      nama_supplier: "Toko A",
      email: null,
      status: "blocked",
      is_active: false,
      payment_terms: "TOP30",
      currency: "IDR",
    });
  });
});

describe("unit import rules", () => {
  it("writes only item.units columns and ignores conversion columns", () => {
    const payload = buildUnitPayload(
      { kode: " BOX ", nama: "Box", tipe: "kecil", faktor_konversi: "12", satuan_induk: "PCS", status: "Active" },
      "company-1"
    );
    expect(payload).toEqual({
      kode: "BOX",
      nama: "Box",
      tipe: "KECIL",
      deskripsi: null,
      is_active: true,
      company_id: "company-1",
    });
  });

  it("rejects a tipe outside BESAR, KECIL and KONVERSI", () => {
    expect(buildUnitPayload({ kode: "L", nama: "Liter", tipe: "" }, null)).toBe(
      "Tipe satuan harus BESAR, KECIL atau KONVERSI"
    );
  });
});
