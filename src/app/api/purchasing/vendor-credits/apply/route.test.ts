// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));
vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/purchasing/vendor-invoices", () => ({ getPoOutstanding: vi.fn() }));
vi.mock("@/lib/purchasing/vendor-credit-apply", () => ({
  applyVendorCredits: vi.fn(),
  listCreditsForPo: vi.fn(async () => []),
}));

import { applyVendorCredits } from "@/lib/purchasing/vendor-credit-apply";
import { getPoOutstanding } from "@/lib/purchasing/vendor-invoices";
import { GET, POST } from "./route";

const PO_ID = "11111111-1111-4111-8111-111111111111";
const url = "http://localhost/api/purchasing/vendor-credits/apply";
const post = (body: unknown) => POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body) }));

describe("/api/purchasing/vendor-credits/apply", () => {
  it("GET rejects a missing purchase_order_id (400)", async () => {
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "purchase_order_id wajib" });
  });

  it("GET returns 404 when the PO does not exist", async () => {
    vi.mocked(getPoOutstanding).mockResolvedValueOnce(null);
    const res = await GET(new NextRequest(`${url}?purchase_order_id=${PO_ID}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "PO tidak ditemukan" });
  });

  it("POST refuses an amount above the outstanding bill", async () => {
    vi.mocked(getPoOutstanding).mockResolvedValueOnce(50_000);
    const res = await post({ purchase_order_id: PO_ID, amount: 60_000 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Jumlah melebihi sisa tagihan PO (50000)",
    });
    expect(applyVendorCredits).not.toHaveBeenCalled();
  });

  it("POST dry run reports the usable credit", async () => {
    vi.mocked(getPoOutstanding).mockResolvedValueOnce(100_000);
    vi.mocked(applyVendorCredits).mockResolvedValueOnce({ allocations: [], remaining: 25_000 });
    const res = await post({ purchase_order_id: PO_ID, amount: 75_000, dry_run: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { allocations: [], remaining: 25_000 },
      message: "Kredit yang bisa dipakai: 50000",
    });
  });
});
