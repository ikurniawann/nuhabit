// PATCH /api/shop/orders/[id]: transisi status pesanan toko online lewat apiHandler.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireIamMenuPrefix = vi.fn();
const queryOne = vi.fn();
const query = vi.fn();
const releaseOrderReservations = vi.fn();
const restoreCommittedReservations = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
}));
vi.mock("@/lib/shop/storefront-server", () => ({
  releaseExpiredReservations: vi.fn(),
  releaseOrderReservations: (...args: unknown[]) => releaseOrderReservations(...args),
  restoreCommittedReservations: (...args: unknown[]) => restoreCommittedReservations(...args),
}));

const ORDER_ID = "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

async function patch(id: string, body: unknown) {
  const { PATCH } = await import("./route");
  const request = new NextRequest(`http://localhost/api/shop/orders/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id }) });
  return { status: response.status, json: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireIamMenuPrefix.mockResolvedValue({ id: "user-1" });
  query.mockResolvedValue([]);
});

describe("PATCH /api/shop/orders/[id]", () => {
  it("tanpa hak menu shop → 403 dari ApiError, tanpa query", async () => {
    const { ApiError } = await import("@/lib/api/auth");
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const res = await patch(ORDER_ID, { status: "packing" });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ success: false, error: "Insufficient permissions" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("id bukan UUID → 404 Order tidak ditemukan", async () => {
    const res = await patch("bukan-uuid", { status: "packing" });
    expect(res.status).toBe(404);
    expect(res.json.error).toBe("Order tidak ditemukan");
  });

  it("transisi tidak dikenal → 400", async () => {
    const res = await patch(ORDER_ID, { status: "shipped" });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("Transisi status tidak dikenal");
  });

  it("status sudah berubah (UPDATE tidak kena baris) → 409", async () => {
    queryOne.mockResolvedValue(null);
    const res = await patch(ORDER_ID, { status: "completed" });
    expect(res.status).toBe(409);
  });

  it("batal dari paid mengembalikan stok committed; respons sukses tetap sama", async () => {
    const updated = { id: ORDER_ID, status: "cancelled", prev_status: "paid" };
    queryOne.mockResolvedValue(updated);
    const res = await patch(ORDER_ID, { status: "cancelled", note: "  refund manual " });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, data: updated });
    expect(queryOne.mock.calls[0][1]).toEqual([ORDER_ID, "cancelled", "refund manual", ["pending", "paid", "packing"]]);
    expect(restoreCommittedReservations).toHaveBeenCalledWith(ORDER_ID);
    expect(releaseOrderReservations).not.toHaveBeenCalled();
  });

  it("galat DB tak terduga → 500 tanpa membocorkan pesan", async () => {
    queryOne.mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await patch(ORDER_ID, { status: "packing" });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ success: false, error: "Terjadi kesalahan server" });
  });
});
