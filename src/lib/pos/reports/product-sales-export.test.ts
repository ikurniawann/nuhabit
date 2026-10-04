import { describe, expect, it } from "vitest";
import type { ProductSalesReport } from "@/lib/pos/reports/types";
import {
  buildProductSalesExportSheets,
  productSalesExportFileName,
} from "@/lib/pos/reports/product-sales-export";

const sample: ProductSalesReport = {
  filters: {
    date_from: "2026-08-01",
    date_to: "2026-08-29",
    warehouse_id: null,
  },
  stall_options: [],
  stall_locked: false,
  summary: { products: 1, quantity: 4, revenue: 120000 },
  rows: [
    {
      product_id: "p1",
      product_name: "Es Teh",
      product_sku: "ET-01",
      warehouse_id: "w1",
      stall_code: "FNB",
      stall_name: "F&B",
      quantity: 4,
      revenue: 120000,
      order_count: 3,
    },
  ],
};

describe("productSalesExportFileName", () => {
  it("bertanggal agar unduhan tidak saling menimpa", () => {
    expect(productSalesExportFileName(sample.filters)).toBe(
      "penjualan-produk-2026-08-01_2026-08-29.xlsx"
    );
  });
});

describe("buildProductSalesExportSheets", () => {
  it("menyusun ringkasan dan baris produk", () => {
    const sheets = buildProductSalesExportSheets(sample);
    expect(sheets.map((s) => s.name)).toEqual(["Ringkasan", "Produk"]);
    const produk = sheets[1]!;
    expect(produk.rows[0]).toEqual([
      "Produk",
      "SKU",
      "Stall",
      "Qty",
      "Orders",
      "Omzet",
    ]);
    expect(produk.rows[1]).toEqual(["Es Teh", "ET-01", "F&B", 4, 3, 120000]);
  });
});
