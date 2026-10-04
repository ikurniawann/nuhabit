// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));
vi.mock("@/lib/purchasing/purchase-returns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchasing/purchase-returns")>()),
  listPurchaseReturns: vi.fn(),
}));

import { listPurchaseReturns } from "@/lib/purchasing/purchase-returns";
import { GET, POST } from "./route";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const url = "http://localhost/api/purchasing/returns";
const post = (body: unknown) => POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body) }));

describe("/api/purchasing/returns", () => {
  it("POST rejects an unknown reason type (400)", async () => {
    const res = await post({ return_date: "2026-10-01", reason_type: "bored", items: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
  });

  it("POST requires header fields before any lookup (400)", async () => {
    const res = await post({ reason_type: "damaged", items: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "Required fields are incomplete" });
  });

  it("POST requires a vendor for product returns (400)", async () => {
    const res = await post({
      module_type: "product",
      return_date: "2026-10-01",
      reason_type: "damaged",
      items: [
        {
          grn_item_id: "11111111-1111-4111-8111-111111111111",
          product_id: null,
          qty_returned: 1,
          unit_cost: 1000,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Vendor is required for product returns",
    });
  });

  it("GET wraps the list with success and passes filters", async () => {
    const payload = { data: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } };
    vi.mocked(listPurchaseReturns).mockResolvedValueOnce(payload);
    const res = await GET(new NextRequest(`${url}?status=approved&sort_order=ASC`));
    expect(await res.json()).toEqual({ success: true, ...payload });
    expect(vi.mocked(listPurchaseReturns).mock.calls[0][1]).toMatchObject({
      status: "approved",
      sortBy: "return_date",
      sortOrder: "ASC",
      moduleType: "raw_material",
    });
  });
});
