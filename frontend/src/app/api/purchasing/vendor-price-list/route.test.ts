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
vi.mock("@/lib/purchasing/vendor-price-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/purchasing/vendor-price-list")>()),
  createPriceList: vi.fn(),
  listPriceLists: vi.fn(),
}));

import { createPriceList, listPriceLists } from "@/lib/purchasing/vendor-price-list";
import { GET, POST } from "./route";

const url = "http://localhost/api/purchasing/vendor-price-list";

describe("/api/purchasing/vendor-price-list", () => {
  it("GET rejects an out-of-range limit (400)", async () => {
    const res = await GET(new NextRequest(`${url}?limit=1000`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
    expect(listPriceLists).not.toHaveBeenCalled();
  });

  it("GET returns data + pagination without a success wrapper", async () => {
    const payload = { data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 1 } };
    vi.mocked(listPriceLists).mockResolvedValueOnce(payload);
    const res = await GET(new NextRequest(url));
    expect(await res.json()).toEqual(payload);
  });

  it("POST validates the body before touching the database", async () => {
    const res = await POST(
      new NextRequest(url, { method: "POST", body: JSON.stringify({ harga: -1 }) })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
    expect(createPriceList).not.toHaveBeenCalled();
  });

  it("POST responds 201 with the created price list", async () => {
    vi.mocked(createPriceList).mockResolvedValueOnce({ id: "pl-1" });
    const res = await POST(
      new NextRequest(url, {
        method: "POST",
        body: JSON.stringify({
          vendor_id: "11111111-1111-4111-8111-111111111111",
          product_id: "22222222-2222-4222-8222-222222222222",
          harga: 12_500,
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "pl-1" },
      message: "Price list created successfully",
    });
  });
});
