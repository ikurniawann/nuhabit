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

describe("/api/pos/tables", () => {
  it("tanpa sesi → 401; payload meja tidak valid → 400", async () => {
    const { GET, POST } = await import("./route");
    session.userId = null;
    expect((await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/tables"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(401);
    session.userId = "kasir-1";
    expect((await POST(({ json: async () => ({ capacity: -1 }), nextUrl: new URL("http://x/"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(400);
  });
});
