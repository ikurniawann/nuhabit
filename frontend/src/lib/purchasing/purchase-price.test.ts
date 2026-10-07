import { describe, expect, it } from "vitest";
import { masterHargaBeliFromBaseUnitCost } from "@/lib/purchasing/purchase-price";

describe("masterHargaBeliFromBaseUnitCost", () => {
  it("keeps cost as-is when material has no small unit", () => {
    expect(
      masterHargaBeliFromBaseUnitCost(6000, {
        satuan_besar_id: "besar",
        satuan_kecil_id: null,
        konversi_factor: 1,
      })
    ).toBe(6000);
  });

  it("scales base-unit cost up to satuan besar", () => {
    // 1 dus = 12 pcs; GRN cost 500 / pcs → master harga_beli 6000 / dus
    expect(
      masterHargaBeliFromBaseUnitCost(500, {
        satuan_besar_id: "dus",
        satuan_kecil_id: "pcs",
        konversi_factor: 12,
      })
    ).toBe(6000);
  });

  it("returns 0 for non-positive cost", () => {
    expect(
      masterHargaBeliFromBaseUnitCost(0, {
        satuan_besar_id: "besar",
        satuan_kecil_id: "kecil",
        konversi_factor: 10,
      })
    ).toBe(0);
  });
});
