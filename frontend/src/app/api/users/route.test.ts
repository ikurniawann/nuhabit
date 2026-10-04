// /api/users: guard IAM dulu, query list divalidasi, galat service dipetakan tanpa bocor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const requireIamMenuPrefix = vi.fn();
const service = {
  listUserEmployees: vi.fn(),
  createUserEmployee: vi.fn(),
  getUserEmployeeById: vi.fn(),
  updateUserEmployee: vi.fn(),
  resetUserEmployeePassword: vi.fn(),
};
const single = vi.fn();

vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (...a: unknown[]) => requireIamMenuPrefix(...a),
}));
vi.mock("@/lib/users/user-service", () => service);
vi.mock("@/lib/pg/create-client", () => ({
  createPgClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));

const ID = "00000000-0000-4000-8000-000000000001";
const ctx = { params: Promise.resolve({ id: ID }) };
const getReq = (qs = "") => {
  const url = new URL(`http://x/api/users${qs}`);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
};
const jsonReq = (body: unknown) =>
  new Request("http://x/api/users", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const validEmployee = {
  full_name: "Budi Santoso",
  email: "budi@example.com",
  join_date: "2026-01-01",
  employment_status: "permanent",
};

beforeEach(async () => {
  Object.values(service).forEach((fn) => fn.mockReset());
  single.mockReset();
  requireIamMenuPrefix.mockReset().mockResolvedValue({ id: "actor-1", role: "hrd" });
});

describe("tanpa grant settings.users", () => {
  it.each([
    ["GET list", async () => (await import("./route")).GET(getReq())],
    ["POST", async () => (await import("./route")).POST(jsonReq(validEmployee))],
    ["GET detail", async () => (await import("./[id]/route")).GET(getReq(), ctx)],
    ["PUT", async () => (await import("./[id]/route")).PUT(jsonReq({ phone: "1" }), ctx)],
    [
      "reset-password",
      async () => (await import("./[id]/reset-password/route")).POST(getReq(), ctx),
    ],
  ])("%s → 403 tanpa menyentuh service", async (_name, run) => {
    const { ApiError } = await import("@/lib/api/auth");
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const res = await run();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "Insufficient permissions",
    });
    Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(single).not.toHaveBeenCalled();
  });
});

describe("GET /api/users", () => {
  it("meneruskan filter yang sudah divalidasi", async () => {
    service.listUserEmployees.mockResolvedValue({
      data: [],
      total: 0,
      page: 2,
      perPage: 15,
    });
    const { GET } = await import("./route");
    const res = await GET(getReq("?page=2&limit=15&is_access_app=true&search=budi"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [],
      total: 0,
      page: 2,
      perPage: 15,
    });
    expect(service.listUserEmployees).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 15,
        isAccessApp: true,
        search: "budi",
        sortBy: "full_name",
      })
    );
  });

  it("sort_by di luar allowlist → 400", async () => {
    const { GET } = await import("./route");
    const res = await GET(getReq("?sort_by=password_hash"));
    expect(res.status).toBe(400);
    expect(service.listUserEmployees).not.toHaveBeenCalled();
  });
});

describe("POST /api/users", () => {
  it("201 dengan bentuk respons lama", async () => {
    service.createUserEmployee.mockResolvedValue({ id: ID });
    const { POST } = await import("./route");
    const res = await POST(jsonReq(validEmployee));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      data: { id: ID },
      message: "Employee created successfully",
    });
    expect(service.createUserEmployee.mock.calls[0][0]).toBe("actor-1");
  });

  it("email dipakai → 409 berpesan jelas", async () => {
    const { ApiError } = await import("@/lib/api/auth");
    const { EMAIL_IN_USE_MESSAGE } = await import("@/lib/users/email-conflict");
    service.createUserEmployee.mockRejectedValue(ApiError.conflict(EMAIL_IN_USE_MESSAGE));
    const { POST } = await import("./route");
    const res = await POST(jsonReq(validEmployee));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: EMAIL_IN_USE_MESSAGE });
  });

  it("galat internal → 500 tanpa membocorkan pesan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    service.createUserEmployee.mockRejectedValue(new Error("connection refused 10.0.0.5"));
    const { POST } = await import("./route");
    const res = await POST(jsonReq(validEmployee));
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toContain("10.0.0.5");
  });

  it("body tidak valid → 400 tanpa memanggil service", async () => {
    const { POST } = await import("./route");
    const res = await POST(jsonReq({ full_name: "B" }));
    expect(res.status).toBe(400);
    expect(service.createUserEmployee).not.toHaveBeenCalled();
  });
});

describe("/api/users/[id]", () => {
  it("GET: tidak ada → 404", async () => {
    service.getUserEmployeeById.mockResolvedValue(null);
    const { GET } = await import("./[id]/route");
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Employee not found");
  });

  it("PUT: karyawan tidak ada → 400 berpesan sama", async () => {
    service.updateUserEmployee.mockRejectedValue(new Error("Employee not found"));
    const { PUT } = await import("./[id]/route");
    const res = await PUT(jsonReq({ phone: "0812" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Employee not found");
  });
});

describe("POST /api/users/[id]/reset-password", () => {
  it("karyawan tanpa akses aplikasi → 400", async () => {
    single.mockResolvedValue({
      data: { user_id: null, is_access_app: false },
      error: null,
    });
    const { POST } = await import("./[id]/reset-password/route");
    const res = await POST(getReq(), ctx);
    expect(res.status).toBe(400);
    expect(service.resetUserEmployeePassword).not.toHaveBeenCalled();
  });

  it("karyawan tidak ada → 404", async () => {
    single.mockResolvedValue({ data: null, error: { code: "PGRST116" } });
    const { POST } = await import("./[id]/reset-password/route");
    expect((await POST(getReq(), ctx)).status).toBe(404);
  });

  it("sukses → message + tempPassword", async () => {
    single.mockResolvedValue({
      data: { user_id: "u-9", is_access_app: true },
      error: null,
    });
    service.resetUserEmployeePassword.mockResolvedValue({
      message: "Password reset successfully",
      tempPassword: "ArkivX!",
    });
    const { POST } = await import("./[id]/reset-password/route");
    const res = await POST(getReq(), ctx);
    expect(await res.json()).toEqual({
      message: "Password reset successfully",
      tempPassword: "ArkivX!",
    });
    expect(service.resetUserEmployeePassword).toHaveBeenCalledWith("u-9");
  });
});
