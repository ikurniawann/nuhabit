// Merge: order di luar scope kasir = tidak ada; PIN (opsional) yang dikirim
// dicek terhadap supervisor order sumber dengan jawaban seragam.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const approve = vi.fn();
const inScope = vi.fn();
const orders: Record<string, Record<string, unknown>> = {};

vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  getPosSession: vi.fn(async () => "kasir-1"),
}));
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: () => ({
    from: () => {
      let id = "";
      const b = {
        select: () => b,
        eq: (_c: string, v: string) => ((id = v), b),
        maybeSingle: async () => ({ data: orders[id] ?? null, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/pos/supervisor-pin-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/supervisor-pin-server")>()),
  approveOrderWithSupervisorPin: (...a: unknown[]) => approve(...a),
  isOrderInUserScope: (...a: unknown[]) => inScope(...a),
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest, {
    params: Promise.resolve({ id: "src" }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const order = (id: string, branch: string) => ({ id, status: "pending", company_id: "c", branch_id: branch });

beforeEach(() => {
  approve.mockReset();
  inScope.mockReset();
  for (const k of Object.keys(orders)) delete orders[k];
  orders.src = order("src", "b1");
  orders.dst = order("dst", "b2");
});

describe("POST /api/pos/orders/[id]/merge", () => {
  it("target di cabang lain (di luar scope kasir) → 404 seperti tidak ada", async () => {
    inScope.mockImplementation(async (_u: string, row: { branch_id: string }) => row.branch_id === "b1");
    const { status } = await post({ target_order_id: "dst" });
    expect(status).toBe(404);
  });

  it("PIN dikirim + order di luar scope → 403 seragam, approve menerima order null", async () => {
    inScope.mockResolvedValue(false);
    approve.mockResolvedValue({ ok: false, reason: "invalid" });
    const { status, json } = await post({ target_order_id: "dst", supervisor_pin: "1234" });
    expect(status).toBe(403);
    expect(json.error).toBe("Invalid supervisor PIN");
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ orderId: "src", order: null }));
  });

  it("PIN terkunci → 429", async () => {
    inScope.mockResolvedValue(true);
    approve.mockResolvedValue({ ok: false, reason: "locked", retryMinutes: 3 });
    expect((await post({ target_order_id: "dst", supervisor_pin: "1234" })).status).toBe(429);
  });
});
