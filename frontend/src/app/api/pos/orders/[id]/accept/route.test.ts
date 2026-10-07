// "Dibuat" pada notifikasi self-order: pending → confirmed, status bayar tetap.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const queryMock = vi.fn();
const guard = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));
vi.mock("@/lib/api/auth", () => ({ requirePosMenu: (...args: unknown[]) => guard(...args) }));

const ID = "11111111-1111-4111-8111-111111111111";
const SELF = "Self-service table order WIT-OFFICE-BDG; payment=cashier";

async function accept(id = ID) {
  const { POST } = await import("./route");
  const res = await POST({} as NextRequest, { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  queryMock.mockReset();
  guard.mockReset().mockResolvedValue({ error: null, userId: "kasir-1" });
});

describe("POST /api/pos/orders/[id]/accept", () => {
  it("self-order pending → confirmed; status bayar tidak diubah; riwayat dicatat", async () => {
    queryMock
      .mockResolvedValueOnce([{ status: "pending", special_requests: SELF, payment_status: "unpaid" }])
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([]);
    const { status, json } = await accept();
    expect(status).toBe(200);
    expect(json.data).toEqual({ id: ID, status: "confirmed", payment_status: "unpaid" });
    const updateSql = String(queryMock.mock.calls[1][0]);
    expect(updateSql).toMatch(/SET status = 'confirmed'/);
    expect(updateSql).not.toMatch(/payment_status/);
    expect(queryMock.mock.calls[2][1]).toEqual([ID, "kasir-1"]);
  });

  it("bukan self-order / sudah diproses / balapan → 409", async () => {
    queryMock.mockResolvedValueOnce([{ status: "pending", special_requests: "GoFood F-1", payment_status: "paid" }]);
    expect((await accept()).status).toBe(409);
    queryMock.mockResolvedValueOnce([{ status: "confirmed", special_requests: SELF, payment_status: "unpaid" }]);
    expect((await accept()).status).toBe(409);
    queryMock.mockResolvedValueOnce([{ status: "pending", special_requests: SELF, payment_status: "unpaid" }]).mockResolvedValueOnce([]);
    expect((await accept()).status).toBe(409);
  });

  it("tanpa akses POS → ditolak guard; id bukan UUID → 400; tidak ada → 404", async () => {
    guard.mockResolvedValueOnce({ error: Response.json({ success: false }, { status: 403 }), userId: null });
    expect((await accept()).status).toBe(403);
    expect((await accept("abc")).status).toBe(400);
    queryMock.mockResolvedValueOnce([]);
    expect((await accept()).status).toBe(404);
  });
});
