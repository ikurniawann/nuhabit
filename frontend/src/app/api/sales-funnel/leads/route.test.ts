// GET/POST /api/sales-funnel/leads lewat apiHandler: guard IAM, scope
// fail-closed, validasi zod, dan 409 duplikat — DB & auth di-mock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}));
const auth = vi.hoisted(() => ({ getApiUser: vi.fn(), hasPrefix: vi.fn(), scope: vi.fn() }));

vi.mock("@/lib/db", () => db);
vi.mock("@/lib/api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth")>()),
  getApiUser: auth.getApiUser,
}));
vi.mock("@/lib/iam/has-menu", () => ({ userHasIamPrefix: auth.hasPrefix }));
vi.mock("@/lib/api/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/scope")>()),
  getApiUserScope: auth.scope,
}));
vi.mock("@/lib/crm/custom-fields-server", () => ({
  loadCustomFieldDefs: vi.fn(async () => []),
  loadExistingCustom: vi.fn(async () => ({})),
}));
vi.mock("@/lib/crm/events", () => ({ emitCrmEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/sales-funnel/account-sync", () => ({ syncLeadAccountContact: vi.fn(async () => undefined) }));

import { GET, POST } from "./route";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const SALES = { id: "33333333-3333-4333-8333-333333333333", full_name: "Sari", role: "sales", brand_id: null };

function get(query = "") {
  return GET(new NextRequest(`http://localhost/api/sales-funnel/leads${query}`));
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/sales-funnel/leads", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

const validLead = { org_name: "PT Maju", pic_name: "Budi", pic_phone: "0812-3456-7890" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getApiUser.mockResolvedValue(SALES);
  auth.hasPrefix.mockResolvedValue(true);
  auth.scope.mockResolvedValue({ businessScope: "branch", companyId: COMPANY, branchId: BRANCH });
});

describe("GET /api/sales-funnel/leads", () => {
  it("401 tanpa sesi", async () => {
    auth.getApiUser.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Authentication required" });
  });

  it("403 tanpa grant menu sales-funnel", async () => {
    auth.hasPrefix.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
  });

  it("403 bila non-super_admin tanpa company scope (fail-closed)", async () => {
    auth.scope.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Scope bisnis/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("filter scope + kepemilikan sales, paginasi dari total_count", async () => {
    db.query.mockResolvedValue([
      { id: "l1", org_name: "PT Maju", total_count: "21" },
      { id: "l2", org_name: "SD Harapan", total_count: "21" },
    ]);
    const res = await get("?status=baru&org_type=bukan-enum&page=2&limit=2");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [
        { id: "l1", org_name: "PT Maju" },
        { id: "l2", org_name: "SD Harapan" },
      ],
      pagination: { page: 2, limit: 2, total: 21, totalPages: 11 },
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("l.company_id = $1");
    expect(sql).toContain("l.branch_id = $2");
    expect(sql).toContain("(l.owner_user_id = $3 OR l.owner_user_id IS NULL)");
    expect(sql).toContain("l.status = $4");
    expect(sql).not.toContain("l.org_type =");
    expect(params).toEqual([COMPANY, BRANCH, SALES.id, "baru", 2, 2]);
  });
});

describe("POST /api/sales-funnel/leads", () => {
  it("400 validasi zod dengan details", async () => {
    const res = await post({ org_name: "" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("400 nomor WA PIC tidak valid", async () => {
    const res = await post({ ...validLead, pic_phone: "12345678" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No. WA PIC tidak valid");
  });

  it("403 sales menunjuk penanggung jawab lain", async () => {
    const res = await post({ ...validLead, owner_user_id: "44444444-4444-4444-8444-444444444444" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Role sales hanya boleh menjadi penanggung jawab sendiri");
  });

  it("409 bila instansi + PIC sudah ada", async () => {
    db.queryOne.mockResolvedValueOnce({ id: "existing" });
    const res = await post(validLead);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Lead instansi ini dengan PIC yang sama sudah ada");
  });

  it("201 menyimpan nomor kanonik dan owner = sales pembuat", async () => {
    db.queryOne
      .mockResolvedValueOnce(null) // cek duplikat
      .mockResolvedValueOnce({ id: "new-lead", org_name: "PT Maju", status: "baru" });
    const res = await post(validLead);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      data: { id: "new-lead", org_name: "PT Maju", status: "baru" },
      message: "Lead berhasil dibuat",
    });
    const insertParams = db.queryOne.mock.calls[1][1] as unknown[];
    expect(insertParams.slice(0, 2)).toEqual([COMPANY, BRANCH]);
    expect(insertParams[6]).toBe("6281234567890");
    expect(insertParams[13]).toBe(SALES.id);
  });

  it("race unique index (23505) dipetakan ke 409 yang sama", async () => {
    db.queryOne.mockResolvedValueOnce(null).mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));
    const res = await post(validLead);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Lead instansi ini dengan PIC yang sama sudah ada");
  });
});
