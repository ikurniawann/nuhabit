// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/auth";
import { parseXlsxToMatrix } from "@/lib/spreadsheet/exceljs-safe";

const requireIamMenuPrefix = vi.fn();
const query = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args) };
});
vi.mock("@/lib/db", () => ({ query: (...args: unknown[]) => query(...args) }));
vi.mock("@/lib/api/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/scope")>();
  return {
    ...actual,
    getApiUserScope: vi.fn(async () => ({
      userId: "user-1",
      role: "admin",
      businessScope: "branch",
      holdingId: "h-1",
      companyId: "c-1",
      branchId: "b-1",
      isUnscoped: false,
    })),
  };
});

import { GET } from "./route";

describe("GET /api/purchasing/export/suppliers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIamMenuPrefix.mockResolvedValue({ id: "user-1" });
  });

  it("403 without the items menu", async () => {
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Insufficient permissions" });
    expect(query).not.toHaveBeenCalled();
  });

  it("scopes the query and streams an .xlsx with the import headers", async () => {
    query.mockResolvedValue([{ kode: "SUP-1", nama_supplier: "Toko A", pic_name: null, status: "active" }]);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="suppliers-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("s.company_id = $1 AND s.branch_id = $2");
    expect(params).toEqual(["c-1", "b-1"]);

    const matrix = await parseXlsxToMatrix(Buffer.from(await res.arrayBuffer()));
    expect(matrix[0].slice(0, 3)).toEqual(["kode", "nama_supplier", "pic_name"]);
    expect(matrix[1].slice(0, 3).map(String)).toEqual(["SUP-1", "Toko A", ""]);
  });
});
