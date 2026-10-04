// Route test alias lama /materials: guard IAM (403), validasi satuan (400), daftar (200).
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
  getApiUserScope: vi.fn(async () => null),
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

describe("/api/purchasing/materials", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
    state.allowed = true;
  });

  it("tanpa grant items → 403", async () => {
    state.allowed = false;
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/materials"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
  });

  it("POST tanpa satuan → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(jsonRequest("http://localhost/api/purchasing/materials", { nama: "Gula" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("satuan_id atau satuan_besar_id wajib diisi");
  });

  it("GET → paginatedResponse", async () => {
    state.fake = createFakeDb({ raw_materials: [{ data: [{ id: "rm-1" }], error: null, count: 1 }] });
    const { GET } = await import("./route");
    const res = await GET(jsonRequest("http://localhost/api/purchasing/materials?limit=5"));
    expect(await res.json()).toEqual({
      success: true,
      data: [{ id: "rm-1" }],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
  });
});
