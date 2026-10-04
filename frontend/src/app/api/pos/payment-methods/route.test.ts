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

const update = vi.fn();
vi.mock("@/lib/pos/payment-methods-store", () => ({
  listPosPaymentMethods: async () => [{ code: "cash" }],
  updatePosPaymentMethod: (...a: unknown[]) => update(...a),
  createPosPaymentMethod: vi.fn(),
  deletePosPaymentMethod: vi.fn(),
}));

describe("/api/pos/payment-methods", () => {
  it("GET cukup sesi POS; PATCH tanpa izin update → 403 tanpa menulis", async () => {
    const { GET, PATCH } = await import("./route");
    expect(await (await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/payment-methods"), headers: new Headers({}) } as unknown as NextRequest))).json()).toMatchObject({ data: [{ code: "cash" }] });
    iam.allowed = false;
    expect((await PATCH(({ json: async () => ({ code: "cash", name: "Tunai" }), nextUrl: new URL("http://x/"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
