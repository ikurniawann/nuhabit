// Route test master kategori item: lookup tak dikenal (404), kode ganda (400), tambah (201).
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
    role: "admin",
    businessScope: "company",
    holdingId: null,
    companyId: "company-1",
    branchId: null,
    isUnscoped: false,
  })),
}));

const URL_BASE = "http://localhost/api/purchasing/items";

describe("/api/purchasing/items/:lookup", () => {
  beforeEach(() => {
    state.fake = createFakeDb({});
  });

  it("GET tipe lookup tak dikenal → 404", async () => {
    const { GET } = await import("./route");
    const res = await GET(jsonRequest(`${URL_BASE}/colors`), routeParams({ lookup: "colors" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Tipe lookup tidak valid" });
  });

  it("POST kode sudah dipakai di company → 400", async () => {
    state.fake = createFakeDb({ product_categories: [{ data: { id: "dup" }, error: null }] });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest(`${URL_BASE}/product-categories`, { code: "kopi", nama: "Kopi" }),
      routeParams({ lookup: "product-categories" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Kode sudah digunakan");
  });

  it("POST valid → 201, kode dikapitalkan, company_id user", async () => {
    state.fake = createFakeDb({
      product_categories: [
        { data: null, error: null },
        { data: { id: "cat-1", code: "KOPI" }, error: null },
      ],
    });
    const { POST } = await import("./route");
    const res = await POST(
      jsonRequest(`${URL_BASE}/product-categories`, { code: " kopi ", nama: " Kopi " }),
      routeParams({ lookup: "product-categories" })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "cat-1", code: "KOPI" }, message: "Berhasil ditambahkan" });
    const insert = state.fake!.calls.find((c) => c.action === "insert");
    expect(insert?.payload).toEqual({
      code: "KOPI",
      nama: "Kopi",
      deskripsi: null,
      is_active: true,
      company_id: "company-1",
    });
  });
});
