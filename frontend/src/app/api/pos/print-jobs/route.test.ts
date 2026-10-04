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

describe("/api/pos/print-jobs", () => {
  it("tanpa sesi & token worker → 401; token worker salah → 401; POST tanpa order_id → 400", async () => {
    process.env.POS_PRINT_WORKER_TOKEN = "worker-secret";
    const { POST } = await import("./route");
    session.userId = null;
    expect((await POST(({ json: async () => ({ order_id: "o1" }), nextUrl: new URL("http://x/"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(401);
    expect((await POST(({ json: async () => ({ order_id: "o1" }), nextUrl: new URL("http://x/"), headers: new Headers({ "x-pos-print-worker-token": "worker-secreX" }) } as unknown as NextRequest))).status).toBe(401);
    const worker = await POST(({ json: async () => ({}), nextUrl: new URL("http://x/"), headers: new Headers({ "x-pos-print-worker-token": "worker-secret" }) } as unknown as NextRequest));
    expect(await worker.json()).toMatchObject({ error: "order_id is required" });
  });
});
