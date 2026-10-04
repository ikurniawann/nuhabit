// Route test resep produk (dipakai POS recipe-builder): 404 { success:false, error }
// untuk baris tak dikenal, dan update membawa waste_factor dari waste_persen.
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

describe("/api/purchasing/bom/:id", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("PUT baris tak dikenal → 404", async () => {
    state.fake = createFakeDb({ bom_items: [{ data: null, error: { code: "PGRST116", message: "No rows" } }] });
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/bom/b-1", { qty_required: 2 }),
      routeParams({ id: "b-1" })
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Item BOM tidak ditemukan" });
  });

  it("PUT qty 0 → 400 sebelum query", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/bom/b-1", { qty_required: 0 }),
      routeParams({ id: "b-1" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Jumlah harus lebih dari 0");
    expect(state.fake!.calls).toHaveLength(0);
  });

  it("PUT valid → 200 dan waste_persen jadi waste_factor", async () => {
    state.fake = createFakeDb({
      bom_items: [
        { data: { id: "b-1" }, error: null },
        { data: { id: "b-1", waste_factor: 0.05 }, error: null },
      ],
    });
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/bom/b-1", { waste_persen: 5 }),
      routeParams({ id: "b-1" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "b-1", waste_factor: 0.05 },
      message: "Item BOM berhasil diupdate",
    });
    const update = state.fake!.calls.find((c) => c.action === "update");
    expect(update?.payload).toMatchObject({ waste_factor: 0.05 });
  });

  it("DELETE → soft delete", async () => {
    state.fake = createFakeDb({ bom_items: [{ data: null, error: null }] });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      jsonRequest("http://localhost/api/purchasing/bom/b-1"),
      routeParams({ id: "b-1" })
    );
    expect(await res.json()).toEqual({ success: true, message: "Bahan berhasil dihapus dari BOM" });
    expect(state.fake!.calls[0]).toMatchObject({ action: "update", payload: { is_active: false } });
  });
});
