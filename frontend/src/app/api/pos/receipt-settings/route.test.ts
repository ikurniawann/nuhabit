import { describe, expect, it, vi } from "vitest";

const session = { userId: "kasir-1" as string | null };
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => session.userId),
}));
vi.mock("@/lib/pg/create-client", () => ({ createPgClient: () => ({}) }));
vi.mock("@/lib/pos/receipt-settings", () => ({
  loadPosReceiptSettingsRows: async () => [{ id: "r1" }],
  normalizeReceiptSettings: (row: { id: string }) => ({ id: row.id, normalized: true }),
}));

describe("GET /api/pos/receipt-settings", () => {
  it("mengembalikan baris ternormalisasi; tanpa sesi 401", async () => {
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ success: true, data: [{ id: "r1", normalized: true }] });
    session.userId = null;
    expect((await GET()).status).toBe(401);
  });
});
