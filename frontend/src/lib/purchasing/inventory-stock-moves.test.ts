import { describe, expect, it } from "vitest";
import { adjustmentDiff, isTransferRuleError } from "./inventory-stock-moves";
import { insufficientStockMessage, supplyUsageNumber } from "./supply-usage";
import { buildSupplyItemPatch } from "./supply-items-api";

describe("inventory-stock-moves", () => {
  it("adjustmentDiff = aktual − sistem", () => {
    expect(adjustmentDiff(10, 7)).toEqual({ qty_before: 10, qty_after: 7, qty_diff: -3 });
  });

  it("isTransferRuleError mengenali galat bisnis transfer", () => {
    expect(isTransferRuleError("Insufficient stock. Available: 2")).toBe(true);
    expect(isTransferRuleError("Source stall not found")).toBe(true);
    expect(isTransferRuleError("connection reset")).toBe(false);
  });
});

describe("supply-usage", () => {
  it("supplyUsageNumber = jumlah hari ini + 1", () => {
    expect(supplyUsageNumber("20261004", 0)).toBe("PMK-20261004-0001");
    expect(supplyUsageNumber("20261004", 41)).toBe("PMK-20261004-0042");
  });

  it("insufficientStockMessage hanya bila diminta > tersedia", () => {
    expect(insufficientStockMessage(5, 5)).toBeNull();
    expect(insufficientStockMessage(6, 5)).toBe(
      "Stok tidak cukup untuk salah satu barang (tersedia 5, diminta 6)"
    );
  });
});

describe("supply-items-api", () => {
  it("buildSupplyItemPatch hanya field yang dikirim, teks dirapikan", () => {
    expect(
      buildSupplyItemPatch({ nama: " Tisu ", kategori: "  ", satuan_id: null }, "u-1")
    ).toEqual({ updated_by: "u-1", nama: "Tisu", kategori: null, satuan_id: null });
  });
});
