import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/auth";

const requireFinanceUser = vi.fn();
vi.mock("@/lib/finance/server", () => ({
  requireFinanceUser: (...args: unknown[]) => requireFinanceUser(...args),
}));

const requireSalesScope = vi.fn();
vi.mock("@/lib/sales-funnel/server", () => ({
  requireSalesScope: (...args: unknown[]) => requireSalesScope(...args),
}));

const query = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => query(...args), queryOne: vi.fn() }));
vi.mock("@/lib/sales-funnel/access", () => ({ findAccessibleDeal: vi.fn() }));

function request(qs = ""): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/finance/invoices${qs}`) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireFinanceUser.mockResolvedValue({ id: "u-1", role: "finance_staff" });
  requireSalesScope.mockResolvedValue({ companyId: "c-1", businessScope: "company", branchId: null });
});

describe("GET /api/finance/invoices", () => {
  it("401 dari guard diteruskan apa adanya", async () => {
    requireFinanceUser.mockRejectedValue(ApiError.unauthorized());
    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Authentication required" });
  });

  it("403 bila user tanpa company scope", async () => {
    requireSalesScope.mockRejectedValue(ApiError.forbidden("Scope company wajib"));
    const { GET } = await import("./route");
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Scope company wajib");
  });

  it("filter tenant + status, hitung status bayar", async () => {
    query.mockResolvedValue([
      { id: "inv-1", amount: "1000", paid: "400", status: "terkirim" },
    ]);
    const { GET } = await import("./route");
    const res = await GET(request("?status=terkirim&q=%20acme%20&status_ignored=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ amount: 1000, paid: 400, payment_status: "sebagian", outstanding: 600 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("i.company_id = $1");
    expect(sql).toContain("i.status = $2");
    expect(sql).toContain("i.invoice_number ILIKE $3 OR l.org_name ILIKE $3");
    expect(params).toEqual(["c-1", "terkirim", "%acme%"]);
  });

  it("status tak dikenal diabaikan", async () => {
    query.mockResolvedValue([]);
    const { GET } = await import("./route");
    await GET(request("?status=hack"));
    expect(query.mock.calls[0][1]).toEqual(["c-1"]);
  });
});
