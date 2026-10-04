// Route test komponen bahan baku: validasi 400 dan update 200.
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

describe("/api/purchasing/raw-material-bom/:id", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("PUT waste_factor > 1 → 400 { success:false, error }", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/raw-material-bom/c-1", { waste_factor: 2 }),
      routeParams({ id: "c-1" })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe("string");
  });

  it("PUT baris tak dikenal → 404", async () => {
    state.fake = createFakeDb({ raw_material_bom_items: [{ data: null, error: { code: "PGRST116" } }] });
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/raw-material-bom/c-1", { qty_required: 1 }),
      routeParams({ id: "c-1" })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Bill of materials item not found");
  });

  it("PUT valid → 200", async () => {
    state.fake = createFakeDb({
      raw_material_bom_items: [
        { data: { id: "c-1" }, error: null },
        { data: { id: "c-1", qty_required: 3 }, error: null },
      ],
    });
    const { PUT } = await import("./route");
    const res = await PUT(
      jsonRequest("http://localhost/api/purchasing/raw-material-bom/c-1", { qty_required: 3 }),
      routeParams({ id: "c-1" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "c-1", qty_required: 3 },
      message: "Bill of materials item updated",
    });
  });
});
