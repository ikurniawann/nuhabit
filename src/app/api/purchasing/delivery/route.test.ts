// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireIamMenuPrefix = vi.fn();
const createDelivery = vi.fn();
const listDeliveries = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});
vi.mock("@/lib/purchasing/delivery-service", () => ({
  createDelivery: (...args: unknown[]) => createDelivery(...args),
  listDeliveries: (...args: unknown[]) => listDeliveries(...args),
}));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));

import { GET, POST } from "./route";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return new NextRequest("http://x/api/purchasing/delivery", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/purchasing/delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamMenuPrefix.mockResolvedValue({ id: "user-1", full_name: "Tester", role: "admin", brand_id: null });
  });

  it("GET rejects an out-of-range limit with 400 { success: false, error }", async () => {
    const res = await GET(new NextRequest("http://x/api/purchasing/delivery?limit=500"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Parameter tidak valid" });
    expect(listDeliveries).not.toHaveBeenCalled();
  });

  it("GET paginates the service result", async () => {
    listDeliveries.mockResolvedValue({ data: [{ id: "d-1" }], total: 41 });
    const res = await GET(new NextRequest("http://x/api/purchasing/delivery?page=2&limit=20"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: [{ id: "d-1" }],
      pagination: { page: 2, limit: 20, total: 41, totalPages: 3 },
    });
  });

  it("POST without a supplier for a raw-material PO is a validation error", async () => {
    const res = await POST(
      post({ po_id: PO_ID, tanggal_kirim: "2026-10-04", no_surat_jalan: "SJ-1", tanggal_estimasi_tiba: "2026-10-05" })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: "Validation failed" });
    expect(createDelivery).not.toHaveBeenCalled();
  });

  it("POST passes a service ApiError through", async () => {
    createDelivery.mockRejectedValue(ApiError.badRequest("Purchase order is not a product purchase order"));
    const res = await POST(
      post({
        po_id: PO_ID,
        supplier_id: SUPPLIER_ID,
        tanggal_kirim: "2026-10-04",
        no_surat_jalan: "SJ-1",
        tanggal_estimasi_tiba: "2026-10-05",
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Purchase order is not a product purchase order");
  });

  it("POST creates the delivery (201)", async () => {
    createDelivery.mockResolvedValue({ id: "d-1", status: "pending" });
    const res = await POST(
      post({
        po_id: PO_ID,
        supplier_id: SUPPLIER_ID,
        tanggal_kirim: "2026-10-04",
        no_surat_jalan: "SJ-1",
        tanggal_estimasi_tiba: "2026-10-05",
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "d-1", status: "pending" },
      message: "Delivery created successfully",
    });
    expect(createDelivery.mock.calls[0][2]).toBe("user-1");
  });

  it("returns 403 when the user lacks the items menu", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const res = await GET(new NextRequest("http://x/api/purchasing/delivery"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
  });
});
