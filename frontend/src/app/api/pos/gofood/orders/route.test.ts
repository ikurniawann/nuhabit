import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const session = { userId: "kasir-1" as string | null };
const iam = { allowed: false };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
  requireIamAction: vi.fn(async () => {
    if (!iam.allowed) throw ApiError.forbidden("Insufficient permissions");
    return { id: "admin-1" };
  }),
  requireIamMenuPrefix: vi.fn(async () => {
    if (!iam.allowed) throw ApiError.forbidden("Insufficient permissions");
    return { id: "admin-1" };
  }),
  requirePosMenu: vi.fn(async () =>
    iam.allowed
      ? { error: null, userId: "kasir-1", user: { id: "kasir-1" } }
      : { error: Response.json({ success: false, error: "Insufficient permissions" }, { status: 403 }), userId: null, user: null }
  ),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));

vi.mock("@/lib/gobiz/service", () => ({ listGofoodOrders: async () => [{ id: "g1" }] }));
vi.mock("@/lib/gobiz/config", () => ({
  loadGobizConfig: async () => ({ enabled: true, autoAccept: false, environment: "sandbox" }),
  isGobizConfigured: () => true,
}));

describe("GET /api/pos/gofood/orders", () => {
  it("tanpa grant menu POS → 403; dengan grant → daftar + meta konfigurasi", async () => {
    const { GET } = await import("./route");
    iam.allowed = false;
    expect((await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/gofood/orders"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(403);
    iam.allowed = true;
    expect(await (await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/gofood/orders"), headers: new Headers({}) } as unknown as NextRequest))).json()).toMatchObject({
      data: [{ id: "g1" }],
      meta: { configured: true, enabled: true, environment: "sandbox" },
    });
  });
});
