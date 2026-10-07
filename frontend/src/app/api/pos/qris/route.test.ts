import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));

describe("POST /api/pos/qris", () => {
  it("tanpa sesi → 401; nominal tidak valid → 400", async () => {
    const { POST } = await import("./route");
    session.userId = null;
    expect((await POST(({ json: async () => ({ amount: 10000 }), nextUrl: new URL("http://x/") } as unknown as NextRequest))).status).toBe(401);
    session.userId = "kasir-qris";
    const res = await POST(({ json: async () => ({ amount: -5 }), nextUrl: new URL("http://x/") } as unknown as NextRequest));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Nominal tidak valid" });
  });
});
