import { describe, expect, it } from "vitest";
import {
  EMPTY_RAW_MATERIAL_FORM,
  buildRawMaterialPayload,
  initialPurchasePackId,
  purchasePackUnitIds,
  rawMaterialFormFromMaterial,
} from "./raw-material-ui-form";
import type { RawMaterialWithStock } from "@/types/purchasing";

const material = {
  id: "rm-1",
  kode: "RM-001",
  nama: "Gula",
  kategori: "KERING",
  satuan_besar_id: "sack",
  satuan_kecil_id: "gram",
  konversi_factor: 50000,
  harga_beli: 750000,
  coa_production: null,
  unit_conversions: [
    { satuan_id: "sack", qty_in_base_unit: 50000 },
    { satuan_id: "gram", qty_in_base_unit: 1, is_base: true },
    { satuan_id: "pack", qty_in_base_unit: 1000, is_purchase_default: true },
  ],
} as unknown as RawMaterialWithStock;

describe("rawMaterialFormFromMaterial", () => {
  it("keeps only extra packs and defaults empty fields", () => {
    const form = rawMaterialFormFromMaterial(material);
    expect(form.unit_conversions.map((c) => c.satuan_id)).toEqual(["pack"]);
    expect(form.coa_production).toBe("");
    expect(form.stok_maximum).toBe(0);
    expect(form.kode).toBe("RM-001");
  });
});

describe("initialPurchasePackId", () => {
  it("prefers the flagged purchase pack", () => {
    expect(initialPurchasePackId(material)).toBe("pack");
  });
});

describe("purchasePackUnitIds", () => {
  it("lists unique non-empty unit ids", () => {
    const form = { ...EMPTY_RAW_MATERIAL_FORM, satuan_besar_id: "sack", unit_conversions: [{ satuan_id: "sack", qty_in_base_unit: 1 }] };
    expect(purchasePackUnitIds(form)).toEqual(["sack"]);
  });
});

describe("buildRawMaterialPayload", () => {
  it("nulls empty COA, drops invalid packs, appends purchase pack flag", () => {
    const payload = buildRawMaterialPayload(
      {
        ...EMPTY_RAW_MATERIAL_FORM,
        coa_rnd: "5-100",
        unit_conversions: [
          { satuan_id: "pack", qty_in_base_unit: 1000, id: "x" },
          { satuan_id: "", qty_in_base_unit: 5 },
          { satuan_id: "box", qty_in_base_unit: 0 },
        ],
      },
      "pack"
    );
    expect(payload.coa_production).toBeNull();
    expect(payload.coa_rnd).toBe("5-100");
    expect(payload.unit_conversions).toEqual([
      { satuan_id: "pack", qty_in_base_unit: 1000, is_base: false },
      { satuan_id: "pack", qty_in_base_unit: 1, is_purchase_default: true },
    ]);
  });

  it("omits the pack flag when no purchase pack is chosen", () => {
    expect(buildRawMaterialPayload(EMPTY_RAW_MATERIAL_FORM).unit_conversions).toEqual([]);
  });
});
