import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const load = vi.fn();
vi.mock("@/lib/table-order/server", () => ({
  loadSellableCatalog: (...a: unknown[]) => load(...a),
  loadCatalogMeta: async () => ({ total: 1 }),
}));
vi.mock("@/lib/table-order/menu", () => ({ buildCategories: () => ["Kopi"] }));

const get = async (url: string) => {
  const { GET } = await import("./route");
  const res = await GET({ nextUrl: new URL(url) } as unknown as NextRequest);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/table-order/products (publik)", () => {
  it("katalog + kategori + meta; galat internal tidak dibocorkan", async () => {
    load.mockResolvedValueOnce([{ id: "p1" }]);
    expect(await get("http://x/api/table-order/products?search=kopi")).toMatchObject({
      status: 200,
      json: { data: [{ id: "p1" }], categories: ["Kopi"], meta: { total: 1 } },
    });
    expect(load).toHaveBeenCalledWith("kopi");
    vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValueOnce(new Error("relation pos.pos_products does not exist"));
    expect(await get("http://x/api/table-order/products")).toEqual({
      status: 500,
      json: { success: false, error: "Terjadi kesalahan server" },
    });
  });
});
