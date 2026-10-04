// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));
vi.mock("@/lib/purchasing/supplier-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchasing/supplier-service")>()),
  createSupplier: vi.fn(),
  listSuppliers: vi.fn(),
}));

import { createSupplier, listSuppliers } from "@/lib/purchasing/supplier-service";
import { GET, POST } from "./route";

const url = "http://localhost/api/purchasing/suppliers";

describe("/api/purchasing/suppliers", () => {
  it("GET rejects an unknown sort direction (400)", async () => {
    const res = await GET(new NextRequest(`${url}?sort_dir=SIDEWAYS`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
    expect(listSuppliers).not.toHaveBeenCalled();
  });

  it("GET keeps the list payload without a success wrapper", async () => {
    const payload = { data: [{ id: "s-1" }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };
    vi.mocked(listSuppliers).mockResolvedValueOnce(payload);
    const res = await GET(new NextRequest(url));
    expect(await res.json()).toEqual(payload);
  });

  it("POST creates a supplier and responds 201 { data }", async () => {
    vi.mocked(createSupplier).mockResolvedValueOnce({ id: "s-1", kode: "SUP-2026-0001" });
    const res = await POST(
      new NextRequest(url, { method: "POST", body: JSON.stringify({ nama_supplier: "CV Kopi" }) })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "s-1", kode: "SUP-2026-0001" } });
    expect(vi.mocked(createSupplier).mock.calls[0][1]).toMatchObject({
      nama_supplier: "CV Kopi",
      payment_terms: "TOP30",
      status: "active",
    });
  });
});
