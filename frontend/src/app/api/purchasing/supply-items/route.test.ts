// Route test barang operasional: kode ganda (400), baris luar scope (404), tambah (201).
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
  getApiUserScope: vi.fn(async () => ({
    userId: "user-1",
    role: "staff",
    businessScope: "branch",
    holdingId: null,
    companyId: "company-1",
    branchId: "branch-1",
    isUnscoped: false,
  })),
}));

describe("/api/purchasing/supply-items", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("POST kode sudah dipakai → 400", async () => {
    state.fake = createFakeDb({ supply_items: [{ data: { id: "dup" }, error: null }] });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/supply-items", { kode: "atk-1", nama: "Pulpen" })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Kode barang sudah digunakan" });
  });

  it("POST valid → 201 dengan scope user", async () => {
    state.fake = createFakeDb({
      supply_items: [
        { data: [], error: null },
        { data: { id: "s-1" }, error: null },
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest("http://localhost/api/purchasing/supply-items", { nama: " Tisu ", stockable: true })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { id: "s-1" } });
    const insert = state.fake!.calls.find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      nama: "Tisu",
      stockable: true,
      company_id: "company-1",
      branch_id: "branch-1",
      created_by: "user-1",
    });
    expect((insert?.payload as { kode: string }).kode).toMatch(/^SUP-\d{8}-001$/);
  });

  it("PATCH baris cabang lain → 404 tanpa update", async () => {
    state.fake = createFakeDb({
      supply_items: [{ data: { id: "s-1", company_id: "company-1", branch_id: "branch-2" }, error: null }],
    });
    const { PATCH } = await import("./[id]/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/purchasing/supply-items/s-1", { nama: "X" }),
      routeParams({ id: "s-1" })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Barang tidak ditemukan");
    expect(state.fake!.calls.some((c) => c.action === "update")).toBe(false);
  });
});
