// Route test master bahan baku: validasi COA (400), pembuatan + konversi satuan (201),
// pack bawaan ganda ditolak sebelum update, komponen BOM tidak boleh diri sendiri.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, jsonRequest, routeParams } from "@/lib/purchasing/item-fake-db.test-util";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const UNIT_KG = "11111111-1111-4111-8111-111111111111";
const UNIT_G = "22222222-2222-4222-8222-222222222222";
const UNIT_SAK = "33333333-3333-4333-8333-333333333333";
const MATERIAL_ID = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("@/lib/purchasing/item-fake-db.test-util").createFakeDb>,
}));

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => state.fake!.db),
}));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));

describe("/api/purchasing/raw-materials", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("POST kode COA tidak valid → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/raw-materials", {
        nama: "Gula",
        kategori: "DRY",
        satuan_besar_id: UNIT_KG,
        coa_asset: "123",
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: "Kode Chart of Accounts tidak valid (gunakan 7 digit, mis. 1301001)",
    });
  });

  it("POST valid → 201 dan konversi satuan kecil/besar di-upsert", async () => {
    state.fake = createFakeDb({
      raw_materials: [
        { data: null, error: null }, // kode belum dipakai
        {
          data: { id: "rm-1", satuan_besar_id: UNIT_KG, satuan_kecil_id: UNIT_G, konversi_factor: 1000 },
          error: null,
        },
      ],
      raw_material_unit_conversions: [{ data: null, error: null }],
    });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/raw-materials", {
        kode_bahan: "BHN-1",
        nama: "Gula",
        kategori: "DRY",
        satuan_besar_id: UNIT_KG,
        satuan_kecil_id: UNIT_G,
        konversi_factor: 1000,
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { id: "rm-1" },
      message: "Raw material added successfully",
    });
    const upsert = state.fake!.calls.find((c) => c.action === "upsert");
    expect(upsert?.payload).toEqual([
      { raw_material_id: "rm-1", satuan_id: UNIT_G, qty_in_base_unit: 1, is_base: true, is_active: true },
      { raw_material_id: "rm-1", satuan_id: UNIT_KG, qty_in_base_unit: 1000, is_base: false, is_active: true },
    ]);
  });

  it("PUT dua pack bawaan pembelian → 400 tanpa mengubah master", async () => {
    state.fake = createFakeDb({ raw_materials: [{ data: { id: MATERIAL_ID }, error: null }] });
    const { PUT } = await import("./[id]/route");
    const res = await PUT(
      jsonRequest(`http://localhost/api/purchasing/raw-materials/${MATERIAL_ID}`, {
        unit_conversions: [
          { satuan_id: UNIT_KG, qty_in_base_unit: 1, is_purchase_default: true },
          { satuan_id: UNIT_SAK, qty_in_base_unit: 25, is_purchase_default: true },
        ],
      }),
      routeParams({ id: MATERIAL_ID })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Hanya satu pack yang boleh menjadi bawaan pembelian/pengeluaran"
    );
    expect(state.fake!.calls.some((c) => c.action === "update")).toBe(false);
  });

  it("POST komponen BOM = bahan itu sendiri → 400", async () => {
    const { POST } = await import("./[id]/bom/route");
    const res = await POST(
      jsonRequest(`http://localhost/api/purchasing/raw-materials/${MATERIAL_ID}/bom`, {
        component_raw_material_id: MATERIAL_ID,
        qty_required: 1,
      }),
      routeParams({ id: MATERIAL_ID })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A raw material cannot be a component of itself");
  });
});
