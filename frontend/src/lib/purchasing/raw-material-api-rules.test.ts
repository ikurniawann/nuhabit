import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/auth";
import {
  conversionUpdateRow,
  normalizeCoaAccountCode,
  packDefaultFlagsToReset,
  planUnitConversions,
  prepareMaterialBody,
  rawMaterialCreateSchema,
  resolveUpdateCoa,
  summarizePurchaseCosts,
  summarizeStockStatus,
} from "./raw-material-api-rules";

const UNIT_KG = "11111111-1111-4111-8111-111111111111";
const UNIT_G = "22222222-2222-4222-8222-222222222222";
const UNIT_SAK = "33333333-3333-4333-8333-333333333333";

describe("raw-material-api-rules", () => {
  it("normalizeCoaAccountCode menerima 7 digit dengan pemisah", () => {
    expect(normalizeCoaAccountCode("1 3 01 001")).toBe("1301001");
    expect(normalizeCoaAccountCode("1-301-001")).toBe("1301001");
    expect(normalizeCoaAccountCode("130100")).toBeNull();
    expect(normalizeCoaAccountCode(null)).toBeNull();
  });

  it("prepareMaterialBody memetakan field lama dan string kosong", () => {
    expect(prepareMaterialBody({ kode_bahan: "B1", nama_bahan: "Gula", deskripsi: "" })).toEqual({
      kode_bahan: "B1",
      nama_bahan: "Gula",
      kode: "B1",
      nama: "Gula",
      deskripsi: null,
    });
    expect(prepareMaterialBody(null)).toEqual({});
  });

  it("skema create menolak kode COA tidak valid", () => {
    const result = rawMaterialCreateSchema.safeParse({
      nama: "Gula",
      kategori: "DRY",
      satuan_besar_id: UNIT_KG,
      coa_asset: "12",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Kode Chart of Accounts tidak valid");
  });

  it("planUnitConversions: satuan kecil basis, satuan besar × konversi, pack menang atribut", () => {
    const planned = planUnitConversions(
      { satuan_besar_id: UNIT_KG, satuan_kecil_id: UNIT_G, konversi_factor: 1000 },
      [
        { satuan_id: UNIT_KG, qty_in_base_unit: 5, is_purchase_default: true },
        { satuan_id: UNIT_SAK, qty_in_base_unit: 25000, barcode: "899" },
      ]
    );
    expect(planned).toEqual([
      { satuan_id: UNIT_G, qty_in_base_unit: 1, is_base: true },
      {
        satuan_id: UNIT_KG,
        qty_in_base_unit: 1000,
        is_base: false,
        is_purchase_default: true,
      },
      { satuan_id: UNIT_SAK, qty_in_base_unit: 25000, barcode: "899", is_base: false },
    ]);
  });

  it("planUnitConversions tanpa satuan kecil: satuan besar jadi basis", () => {
    expect(planUnitConversions({ satuan_besar_id: UNIT_KG, konversi_factor: 1000 }, [])).toEqual([
      { satuan_id: UNIT_KG, qty_in_base_unit: 1, is_base: true },
    ]);
  });

  it("packDefaultFlagsToReset: satu flag → reset, dua flag → 400", () => {
    expect(packDefaultFlagsToReset([{ is_issue_default: true }, {}])).toEqual(["is_issue_default"]);
    expect(() =>
      packDefaultFlagsToReset([{ is_purchase_default: true }, { is_purchase_default: true }])
    ).toThrow(ApiError);
  });

  it("conversionUpdateRow hanya menulis flag/barcode yang dikirim", () => {
    const row = conversionUpdateRow(
      "rm-1",
      { satuan_id: UNIT_SAK, qty_in_base_unit: 25, is_base: false, barcode: "" },
      "2026-10-04T00:00:00.000Z"
    );
    expect(row).toEqual({
      raw_material_id: "rm-1",
      satuan_id: UNIT_SAK,
      qty_in_base_unit: 25,
      is_base: false,
      is_active: true,
      barcode: null,
      updated_at: "2026-10-04T00:00:00.000Z",
    });
  });

  it("resolveUpdateCoa: eksplisit menang, selain itu turunan kode atau nilai lama", () => {
    expect(resolveUpdateCoa({ coa: "RND" }, { coa: "ASSET" })).toBe("RND");
    expect(resolveUpdateCoa({}, { coa: "ASSET" })).toBe("ASSET");
  });

  it("summarizeStockStatus menghitung status kosong sebagai AMAN", () => {
    expect(
      summarizeStockStatus([
        { status_stok: "MENIPIS" },
        { status_stok: "HABIS" },
        { status_stok: null },
        { status_stok: "AMAN" },
      ])
    ).toEqual({ total: 4, aman: 2, menipis: 1, habis: 1 });
  });

  it("summarizePurchaseCosts: terakhir = elemen pertama", () => {
    expect(summarizePurchaseCosts([300, 100, 200], 12)).toEqual({
      months: 12,
      purchase_count: 3,
      last_cost: 300,
      min_cost: 100,
      max_cost: 300,
      avg_cost: 200,
    });
    expect(summarizePurchaseCosts([], 6)).toMatchObject({ purchase_count: 0, last_cost: null });
  });
});
