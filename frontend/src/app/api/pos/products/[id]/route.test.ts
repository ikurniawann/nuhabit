// Edit katalog produk = data master: kasir (grant read saja) ditolak 403.
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const update = vi.fn();
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requireIamAction: vi.fn(async (menus: string[], action: string) => {
    if (action === "update" && menus.includes("pos.catalog.products")) throw ApiError.forbidden("Insufficient permissions");
    return { id: "u" };
  }),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({ from: () => ({ update }) }) }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

describe("PATCH /api/pos/products/[id]", () => {
  it("tanpa izin update pos.catalog.products → 403 sebelum menulis", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH({ json: async () => ({ is_active: false }) } as unknown as NextRequest, {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
