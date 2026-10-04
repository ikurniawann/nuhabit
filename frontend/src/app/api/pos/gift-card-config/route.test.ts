import { describe, expect, it, vi } from "vitest";

const session = { userId: "kasir-1" as string | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/giftcard/giftcard-server", () => ({
  loadGiftCardConfig: async () => ({ presets: [50000, 100000], allow_custom: true, expiry_months: 12 }),
}));

describe("GET /api/pos/gift-card-config", () => {
  it("kasir menerima preset tanpa masa berlaku; tanpa sesi 401", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(await res.json()).toEqual({ success: true, data: { presets: [50000, 100000], allow_custom: true } });
    session.userId = null;
    expect((await GET()).status).toBe(401);
  });
});
