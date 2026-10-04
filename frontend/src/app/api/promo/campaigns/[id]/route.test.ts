// Promo — PATCH /api/promo/campaigns/[id]: konteks venue, aturan edit setelah
// voucher terpakai, dan UPDATE hanya kolom yang dikirim.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamMenuPrefix = vi.fn();
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
}));
vi.mock("@/lib/api/scope", () => ({ getApiUserScope: vi.fn(async () => null) }));
const resolveTicketingVenue = vi.fn();
vi.mock("@/lib/ticketing/server", () => ({ resolveTicketingVenue: (...a: unknown[]) => resolveTicketingVenue(...a) }));

const query = vi.fn();
const queryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
  withTransaction: vi.fn(),
}));

const { PATCH } = await import("./route");

const call = (body: unknown) =>
  PATCH(
    new Request("http://test/api/promo/campaigns/c1", { method: "PATCH", body: JSON.stringify(body) }) as unknown as NextRequest,
    { params: Promise.resolve({ id: "c1" }) }
  );

const snapshot = (captured: string) => ({
  discount_type: "percent", value: "10", valid_from: null, valid_until: null, captured_count: captured,
});

describe("PATCH /api/promo/campaigns/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamMenuPrefix.mockResolvedValue({ id: "u1", role: "marketing", full_name: "M", brand_id: null });
    resolveTicketingVenue.mockResolvedValue({ companyId: "co", branchId: "br" });
  });

  it("400 bila venue belum dikonfigurasi", async () => {
    resolveTicketingVenue.mockResolvedValue({ companyId: null, branchId: null });
    const res = await call({ is_active: false });
    expect(res.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("404 campaign di venue lain; 409 ubah diskon setelah voucher terpakai", async () => {
    queryOne.mockResolvedValueOnce(null);
    expect((await call({ name: "Baru" })).status).toBe(404);

    queryOne.mockResolvedValueOnce(snapshot("2"));
    const res = await call({ value: 20 });
    expect(res.status).toBe(409);
    expect(query).not.toHaveBeenCalled();
  });

  it("saklar tetap boleh setelah terpakai; UPDATE memakai parameter berurutan + venue", async () => {
    queryOne.mockResolvedValueOnce(snapshot("2"));
    query.mockResolvedValueOnce([]);
    const res = await call({ is_active: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { id: "c1" }, message: "Campaign diperbarui" });
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("SET updated_at = now(), is_active = $1");
    expect(sql).toContain("WHERE id = $2 AND branch_id = $3");
    expect(values).toEqual([false, "c1", "br", "co"]);
  });

  it("400 Validation failed untuk body di luar skema", async () => {
    const res = await call({ value: -1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
  });
});
