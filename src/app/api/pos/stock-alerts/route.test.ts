import { describe, expect, it, vi } from "vitest";
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

describe("GET /api/pos/stock-alerts", () => {
  it("tanpa sesi POS → 401", async () => {
    const { GET } = await import("./route");
    session.userId = null;
    expect((await GET()).status).toBe(401);
  });
});
