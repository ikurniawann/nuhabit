import { describe, expect, it } from "vitest";
import { buildStockAlertTickerSegments, hasCriticalStockAlert } from "./ticker";
import type {
  PosProductStockAlert,
  ProductAtRiskAlert,
  RawMaterialAlert,
} from "@/lib/pos/stock-alerts-types";

function raw(
  partial: Partial<RawMaterialAlert> & Pick<RawMaterialAlert, "id" | "nama" | "status_stok" | "alert_level">
): RawMaterialAlert {
  return {
    kode: "RM",
    kategori: "Umum",
    qty_onhand: 1,
    min_stock: 5,
    satuan: "kg",
    ...partial,
  };
}

function product(
  partial: Partial<ProductAtRiskAlert> &
    Pick<ProductAtRiskAlert, "product_id" | "nama" | "max_servings" | "alert_level">
): ProductAtRiskAlert {
  return {
    kode: "PR",
    limiting_ingredient: "X",
    ingredients: [],
    ...partial,
  };
}

function pos(
  partial: Partial<PosProductStockAlert> &
    Pick<PosProductStockAlert, "id" | "name" | "current" | "alert_level">
): PosProductStockAlert {
  return {
    sku: "SKU",
    min: 5,
    ...partial,
  };
}

describe("buildStockAlertTickerSegments", () => {
  it("returns empty array when there are no alerts", () => {
    expect(
      buildStockAlertTickerSegments({
        raw_materials: [],
        products_at_risk: [],
        pos_products: [],
      })
    ).toEqual([]);
  });

  it("formats raw, product, and POS segments", () => {
    expect(
      buildStockAlertTickerSegments({
        raw_materials: [raw({ id: "1", nama: "Gula", status_stok: "HABIS", alert_level: "critical" })],
        products_at_risk: [
          product({ product_id: "p1", nama: "Latte", max_servings: 2, alert_level: "warning" }),
        ],
        pos_products: [pos({ id: "s1", name: "Air Mineral", current: 3, alert_level: "warning" })],
      })
    ).toEqual(["Gula · HABIS", "Latte · 2 porsi", "Air Mineral · MENIPIS"]);
  });

  it("uses HABIS for POS when current is zero or below", () => {
    expect(
      buildStockAlertTickerSegments({
        raw_materials: [],
        products_at_risk: [],
        pos_products: [pos({ id: "s1", name: "Snack", current: 0, alert_level: "critical" })],
      })
    ).toEqual(["Snack · HABIS"]);
  });

  it("orders critical before warning, and raw → product → POS within level", () => {
    expect(
      buildStockAlertTickerSegments({
        raw_materials: [
          raw({ id: "w", nama: "Tepung", status_stok: "MENIPIS", alert_level: "warning" }),
          raw({ id: "c", nama: "Gula", status_stok: "HABIS", alert_level: "critical" }),
        ],
        products_at_risk: [
          product({ product_id: "pw", nama: "Kopi", max_servings: 5, alert_level: "warning" }),
          product({ product_id: "pc", nama: "Latte", max_servings: 1, alert_level: "critical" }),
        ],
        pos_products: [
          pos({ id: "sw", name: "Air", current: 2, alert_level: "warning" }),
          pos({ id: "sc", name: "Snack", current: 0, alert_level: "critical" }),
        ],
      })
    ).toEqual([
      "Gula · HABIS",
      "Latte · 1 porsi",
      "Snack · HABIS",
      "Tepung · MENIPIS",
      "Kopi · 5 porsi",
      "Air · MENIPIS",
    ]);
  });
});

describe("hasCriticalStockAlert", () => {
  it("is true when any source has critical", () => {
    expect(
      hasCriticalStockAlert({
        raw_materials: [],
        products_at_risk: [
          product({ product_id: "p", nama: "Latte", max_servings: 1, alert_level: "critical" }),
        ],
        pos_products: [],
      })
    ).toBe(true);
  });

  it("is false when only warnings", () => {
    expect(
      hasCriticalStockAlert({
        raw_materials: [raw({ id: "1", nama: "Gula", status_stok: "MENIPIS", alert_level: "warning" })],
        products_at_risk: [],
        pos_products: [],
      })
    ).toBe(false);
  });
});
