// Route test daftar stall: guard IAM (403) dan user company tanpa cabang → [].
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, jsonRequest } from "@/lib/purchasing/item-fake-db.test-util";

const state = vi.hoisted(() => ({
  fake: null as null | ReturnType<typeof import("@/lib/purchasing/item-fake-db.test-util").createFakeDb>,
  allowed: true,
}));

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: vi.fn(async () => state.fake!.db),
}));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => ({
    userId: "user-1",
    role: "admin",
    businessScope: "company",
    holdingId: null,
    companyId: "company-1",
    branchId: null,
    isUnscoped: false,
  })),
}));
vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: vi.fn(async () => {
      if (!state.allowed) throw actual.ApiError.forbidden();
      return { id: "user-1", full_name: "Admin", role: "admin", brand_id: null };
    }),
  };
});

describe("/api/purchasing/warehouses", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
    state.allowed = true;
  });

  it("tanpa grant → 403", async () => {
    state.allowed = false;
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/warehouses"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
  });

  it("branch_id bukan uuid → 400", async () => {
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/warehouses?branch_id=x"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Branch ID harus valid");
  });

  it("company tanpa cabang → { success, data: [] }", async () => {
    state.fake = createFakeDb({ branches: [{ data: [], error: null }] });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/warehouses"));
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  it("company dengan cabang → filter branch_id IN", async () => {
    state.fake = createFakeDb({
      branches: [{ data: [{ id: "branch-1" }], error: null }],
      warehouses: [{ data: [{ id: "w-1", name: "Stall A" }], error: null }],
    });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/warehouses"));
    expect(await res.json()).toEqual({ success: true, data: [{ id: "w-1", name: "Stall A" }] });
    const warehouseCall = state.fake!.calls.find((c) => c.table === "warehouses");
    expect(warehouseCall?.filters).toContainEqual(["in", "branch_id", ["branch-1"]]);
  });
});
