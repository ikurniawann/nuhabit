import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));

describe("/api/pos/customers", () => {
  it("tanpa sesi → 401; POST tanpa nomor HP → 400 sebelum DB", async () => {
    const { GET, POST } = await import("./route");
    session.userId = null;
    expect((await GET(({ json: async () => ({}), nextUrl: new URL("http://x/api/pos/customers") } as unknown as NextRequest))).status).toBe(401);
    session.userId = "kasir-1";
    const res = await POST(({ json: async () => ({ name: "Ana" }), nextUrl: new URL("http://x/") } as unknown as NextRequest));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Nomor HP wajib diisi" });
  });
});
