// Void: order dimuat dulu, PIN dicek terhadap supervisor order itu; order
// hilang dijawab sama dengan PIN salah; terkunci → 429.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const approve = vi.fn();
let orderRow: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({ getPosSession: vi.fn(async () => "kasir-1") }));
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: () => ({
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: orderRow, error: null }) };
      return b;
    },
  }),
}));
vi.mock("@/lib/pos/supervisor-pin-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/pos/supervisor-pin-server")>()),
  approveOrderWithSupervisorPin: (...a: unknown[]) => approve(...a),
}));

async function post(body: unknown) {
  const { POST } = await import("./route");
  const res = await POST({ json: async () => body } as unknown as NextRequest, {
    params: Promise.resolve({ id: "ord-1" }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  approve.mockReset();
  orderRow = null;
});

describe("POST /api/pos/orders/[id]/void", () => {
  it("order hilang & PIN salah → jawaban identik 403", async () => {
    approve.mockResolvedValue({ ok: false, reason: "invalid" });
    const missing = await post({ reason: "salah input", supervisor_pin: "1234" });
    orderRow = { id: "ord-1", status: "completed", company_id: "c", branch_id: "b" };
    const wrongPin = await post({ reason: "salah input", supervisor_pin: "9999" });
    expect(missing).toEqual(wrongPin);
    expect(missing).toEqual({ status: 403, json: { success: false, error: "PIN supervisor tidak valid" } });
    expect(approve).toHaveBeenNthCalledWith(1, expect.objectContaining({ callerId: "kasir-1", orderId: "ord-1", order: null }));
  });

  it("terkunci → 429 dengan sisa menit", async () => {
    approve.mockResolvedValue({ ok: false, reason: "locked", retryMinutes: 12 });
    const { status, json } = await post({ reason: "x", supervisor_pin: "1234" });
    expect(status).toBe(429);
    expect(String(json.error)).toContain("12 menit");
  });
});
