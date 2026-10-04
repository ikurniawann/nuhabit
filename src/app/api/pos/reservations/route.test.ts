import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const session = { userId: "kasir-1" as string | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));

describe("POST /api/pos/reservations", () => {
  it("tanpa sesi → 401; tanggal/jam/pax atau nama kosong → 400", async () => {
    const { POST } = await import("./route");
    session.userId = null;
    expect((await POST(({ json: async () => ({}), nextUrl: new URL("http://x/") } as unknown as NextRequest))).status).toBe(401);
    session.userId = "kasir-1";
    expect((await POST(({ json: async () => ({ customer_name: "Ana" }), nextUrl: new URL("http://x/") } as unknown as NextRequest))).status).toBe(400);
    const noName = await POST(({ json: async () => ({ reservation_date: "2026-10-05", time_slot: "12:00", pax_count: 2 }), nextUrl: new URL("http://x/") } as unknown as NextRequest));
    expect(await noName.json()).toMatchObject({ error: "Customer name is required" });
  });
});
