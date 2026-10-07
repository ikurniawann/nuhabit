// Harga channel: PUT butuh aksi "update" IAM, harga divalidasi (bulat > 0),
// null = hapus harga manual, channel tak dikenal ditolak.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

class FakeApiError extends Error {
  constructor(public status: number) {
    super("forbidden");
  }
  toResponse() {
    return new Response(JSON.stringify({ success: false }), { status: this.status });
  }
}

const requireAction = vi.fn(async () => ({ id: "user-1" }));
const clientQuery = vi.fn(async () => ({ rowCount: 1 }));
const loadRule = vi.fn(async (code: string) => (code === "gofood" ? { code: "gofood" } : null));

vi.mock("@/lib/api/auth", () => ({
  ApiError: FakeApiError,
  requireIamAction: (...args: unknown[]) => requireAction(...(args as [])),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/db", () => ({
  withTransaction: (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }),
}));
vi.mock("@/lib/pos/channel-pricing-server", () => ({
  loadChannelRule: (code: string) => loadRule(code),
  loadSalesChannels: vi.fn(async () => []),
  loadChannelProducts: vi.fn(async () => []),
  loadChannelOverrides: vi.fn(async () => new Map()),
}));

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

async function put(body: unknown) {
  const { PUT } = await import("./route");
  const response = await PUT({ json: async () => body } as unknown as NextRequest);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  requireAction.mockClear();
  clientQuery.mockClear();
});

describe("PUT /api/pos/channel-prices", () => {
  it("simpan harga manual + hapus (null) dalam satu transaksi, aksi IAM update", async () => {
    const { status, json } = await put({
      channel: "gofood",
      prices: [
        { product_id: P1, price: 29000 },
        { product_id: P2, price: null },
      ],
    });
    expect(status).toBe(200);
    expect(requireAction).toHaveBeenCalledWith(["pos.catalog.channel-prices"], "update");
    const [del, ins] = clientQuery.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(del[0]).toMatch(/DELETE FROM pos\.pos_product_channel_prices/);
    expect(del[1]).toEqual(["gofood", [P2]]);
    expect(ins[0]).toMatch(/INSERT INTO pos\.pos_product_channel_prices/);
    expect(ins[1]).toEqual(["gofood", [P1], [29000], "user-1"]);
    expect(json.data).toEqual({ saved: 1, cleared: 1 });
  });

  it("reset_all menghapus semua harga manual channel", async () => {
    const { status } = await put({ channel: "gofood", reset_all: true });
    expect(status).toBe(200);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect((clientQuery.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual(["gofood"]);
  });

  it("harga pecahan / 0 / negatif / id bukan UUID → 400 tanpa query", async () => {
    for (const price of [29000.5, 0, -1000]) {
      expect((await put({ channel: "gofood", prices: [{ product_id: P1, price }] })).status).toBe(400);
    }
    expect((await put({ channel: "gofood", prices: [{ product_id: "x", price: 1000 }] })).status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("channel tak dikenal → 404", async () => {
    expect((await put({ channel: "tokopedia", prices: [{ product_id: P1, price: 1000 }] })).status).toBe(404);
  });

  it("tanpa hak update → 403", async () => {
    requireAction.mockRejectedValueOnce(new FakeApiError(403));
    expect((await put({ channel: "gofood", reset_all: true })).status).toBe(403);
    expect(clientQuery).not.toHaveBeenCalled();
  });
});
