// Route test master satuan: validasi (400), satuan terpakai tak bisa dihapus (400), daftar (200).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, jsonRequest, routeParams } from "@/lib/purchasing/item-fake-db.test-util";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

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

describe("/api/purchasing/units", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("POST tanpa tipe → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(jsonRequest("http://localhost/api/purchasing/units", { kode: "KG", nama: "Kilogram" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Tipe satuan wajib dipilih" });
  });

  it("DELETE satuan yang dipakai bahan baku → 400", async () => {
    state.fake = createFakeDb({ raw_materials: [{ data: [{ id: "rm-1" }], error: null }] });
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(
      jsonRequest("http://localhost/api/purchasing/units/u-1"),
      routeParams({ id: "u-1" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Satuan tidak bisa dihapus karena masih digunakan di bahan baku"
    );
  });

  it("GET → { data, pagination } tanpa key success (bentuk lama)", async () => {
    state.fake = createFakeDb({ units: [{ data: [{ id: "u-1" }], error: null, count: 3 }] });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/units?limit=2"));
    expect(await res.json()).toEqual({
      data: [{ id: "u-1" }],
      pagination: { page: 1, limit: 2, total: 3, total_pages: 2 },
    });
  });
});
