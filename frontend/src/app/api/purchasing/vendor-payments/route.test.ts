// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/pg/create-client", () => ({ createServerPgClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: vi.fn(async () => null),
}));
vi.mock("@/lib/purchasing/vendor-invoices", () => ({ listPurchaseInvoices: vi.fn() }));

import { listPurchaseInvoices } from "@/lib/purchasing/vendor-invoices";
import { GET } from "./route";

// Lolos guard IAM; uji guard ada di src/test/api/purchasing-guard.test.ts.
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: vi.fn(async () => ({ id: "user-1", full_name: "Admin", role: "admin", brand_id: null })),
}));

const get = (query: string) => GET(new NextRequest(`http://localhost/api/purchasing/vendor-payments${query}`));

describe("GET /api/purchasing/vendor-payments", () => {
  it("lists invoices for the requested module and status", async () => {
    vi.mocked(listPurchaseInvoices).mockResolvedValueOnce([]);
    const res = await get("?module_type=product&status=overdue&search=%20PO-1%20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
    expect(vi.mocked(listPurchaseInvoices).mock.calls[0][1]).toEqual({
      moduleType: "product",
      search: "PO-1",
      status: "overdue",
    });
  });

  it("hides internal errors behind a generic 500", async () => {
    vi.mocked(listPurchaseInvoices).mockRejectedValueOnce(new Error("relation does not exist"));
    vi.spyOn(console, "error").mockImplementationOnce(() => undefined);
    const res = await get("");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Terjadi kesalahan server" });
  });
});
