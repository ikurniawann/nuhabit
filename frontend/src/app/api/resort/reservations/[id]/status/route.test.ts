// Resort — POST /api/resort/reservations/[id]/status: transisi status di dalam
// transaksi; galat bisnis dilempar sebagai ApiError (transaksi dibatalkan).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamAction = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamAction: (...args: unknown[]) => requireIamAction(...args),
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: vi.fn(async () => ({ companyId: "co", branchId: "br" })) }));

const clientQuery = vi.fn();
const queryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: (...a: unknown[]) => queryOne(...a),
  withTransaction: async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }),
}));

const { POST } = await import("./route");

const call = (body: unknown) =>
  POST(
    new Request("http://test/api/resort/reservations/r1/status", { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest,
    { params: Promise.resolve({ id: "r1" }) }
  );

const reservation = (status: string) => ({
  rows: [{ id: "r1", status, reservation_code: "RSV-ABC123", guest_name: "Budi" }],
});

describe("POST /api/resort/reservations/[id]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamAction.mockResolvedValue({ id: "u1", role: "admin", full_name: "FO", brand_id: null });
    queryOne.mockResolvedValue({ full_name: "Sari" });
  });

  it("400 untuk aksi yang tidak dikenal", async () => {
    const res = await call({ action: "hapus" });
    expect(res.status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("404 reservasi tidak ada; 409 transisi tidak sah", async () => {
    clientQuery.mockResolvedValueOnce({ rows: [] });
    expect((await call({ action: "konfirmasi" })).status).toBe(404);

    clientQuery.mockResolvedValueOnce(reservation("menunggu-bayar"));
    const res = await call({ action: "check-out" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Tidak bisa mengubah status");
  });

  it("check-out menolak folio bersaldo tanpa force (pesan memakai format rupiah)", async () => {
    clientQuery
      .mockResolvedValueOnce(reservation("check-in"))
      .mockResolvedValueOnce({ rows: [{ direction: "debit", amount: "1500000" }, { direction: "kredit", amount: "500000" }] });
    const res = await call({ action: "check-out" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Rp1.000.000");
  });

  it("konfirmasi sukses: status + paid_at, pesan ringkas", async () => {
    clientQuery.mockResolvedValueOnce(reservation("menunggu-bayar")).mockResolvedValue({ rows: [] });
    const res = await call({ action: "konfirmasi" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "r1", status: "terkonfirmasi", code: "RSV-ABC123", guest: "Budi" },
      message: "RSV-ABC123 — Budi: Terkonfirmasi",
    });
    const update = clientQuery.mock.calls.find(([sql]) => String(sql).includes("SET status = $2"));
    expect(update?.[0]).toContain("paid_at = COALESCE(paid_at, now())");
    expect(update?.[1]).toEqual(["r1", "terkonfirmasi"]);
  });
});
