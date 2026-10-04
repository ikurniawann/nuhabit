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

const queries: Array<{ sql: string; params: unknown[] }> = [];
vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    return [];
  }),
}));

describe("GET /api/pos/member-cards", () => {
  it("tanpa sesi → 401; tap kartu mencari UID ternormalisasi (bukan pencarian bebas)", async () => {
    const { GET } = await import("./route");
    session.userId = null;
    expect((await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/member-cards"), headers: new Headers({}) } as unknown as NextRequest))).status).toBe(401);
    session.userId = "kasir-1";
    const res = await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/member-cards?nfc_uid=04:aa:bb&search=ana"), headers: new Headers({}) } as unknown as NextRequest));
    expect(res.status).toBe(200);
    const members = queries.find((q) => q.sql.includes("FROM pos.pos_customers c"));
    expect(members?.sql).toContain("upper(c.nfc_uid) = upper($1)");
    expect(members?.sql).not.toContain("ILIKE");
  });
});
