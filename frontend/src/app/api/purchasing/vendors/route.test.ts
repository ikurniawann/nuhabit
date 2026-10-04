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
vi.mock("@/lib/purchasing/vendor-directory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchasing/vendor-directory")>()),
  createVendor: vi.fn(),
  listVendors: vi.fn(),
}));

import { createVendor, listVendors } from "@/lib/purchasing/vendor-directory";
import { GET, POST } from "./route";

const url = "http://localhost/api/purchasing/vendors";
const validVendor = {
  name: "PT Sumber",
  contact_person: "Andi",
  phone: "0812",
  email: "andi@sumber.id",
  address: "Bandung",
  category: "office",
};

describe("/api/purchasing/vendors", () => {
  it("GET forwards parsed query params", async () => {
    vi.mocked(listVendors).mockResolvedValueOnce({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 1 } });
    const res = await GET(new NextRequest(`${url}?usage_scope=fnb&status=active`));
    expect(res.status).toBe(200);
    expect(vi.mocked(listVendors).mock.calls[0][1]).toEqual({
      usage_scope: "fnb",
      status: "active",
      page: 1,
      limit: 10,
    });
  });

  it("POST rejects an invalid email (400)", async () => {
    const res = await POST(
      new NextRequest(url, { method: "POST", body: JSON.stringify({ ...validVendor, email: "x" }) })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
    expect(createVendor).not.toHaveBeenCalled();
  });

  it("POST defaults usage_scope and responds 201", async () => {
    vi.mocked(createVendor).mockResolvedValueOnce({ id: "v-1", code: "V-2026-0001" });
    const res = await POST(new NextRequest(url, { method: "POST", body: JSON.stringify(validVendor) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "v-1", code: "V-2026-0001" },
      message: "Vendor created successfully",
    });
    expect(vi.mocked(createVendor).mock.calls[0][1]).toMatchObject({ usage_scope: "keduanya" });
  });
});
