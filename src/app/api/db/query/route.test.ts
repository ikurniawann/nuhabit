// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  queryOne: vi.fn(),
  grantedCodes: vi.fn(),
  fromSpec: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUserFromCookies: mocks.session }));
vi.mock("@/lib/db", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/lib/iam/has-menu", () => ({ loadGrantedMenuCodesForUser: mocks.grantedCodes }));
vi.mock("@/lib/pg/query-builder", () => ({ QueryBuilder: { fromSpec: mocks.fromSpec } }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/db/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/** queryOne dipanggil untuk resolusi schema lalu role. */
function mockDb(schema: string | null, role: string | null) {
  mocks.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("to_regclass")) return schema ? { nspname: schema } : null;
    return role ? { role } : null;
  });
}

describe("POST /api/db/query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.session.mockResolvedValue({ id: "user-1", email: "a@b.c" });
    mocks.fromSpec.mockResolvedValue({ data: [], error: null, count: null, status: 200 });
  });

  it("401 tanpa sesi", async () => {
    mocks.session.mockResolvedValue(null);
    const res = await post({ table: "candidates" });
    expect(res.status).toBe(401);
  });

  it("403 + log untuk role employee yang membaca tabel di luar allowlist", async () => {
    mockDb("iam", "employee");
    mocks.grantedCodes.mockResolvedValue(["ess"]);
    const res = await post({ table: "user_roles", action: "select" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      data: null,
      error: { message: "Query not permitted", code: "DB_QUERY_FORBIDDEN" },
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[api/db/query] denied",
      expect.objectContaining({ userId: "user-1", schema: "iam", table: "user_roles", action: "select" })
    );
    expect(mocks.fromSpec).not.toHaveBeenCalled();
  });

  it("403 untuk schema auth eksplisit", async () => {
    mockDb(null, "super_admin");
    mocks.grantedCodes.mockResolvedValue([]);
    const res = await post({ schema: "auth", table: "users" });
    expect(res.status).toBe(403);
  });

  it("menyuntik filter id untuk baca users sendiri dan mengunci schema hasil resolusi", async () => {
    mockDb("configuration", "employee");
    mocks.grantedCodes.mockResolvedValue([]);
    const res = await post({
      schema: "public",
      table: "users",
      select: "role",
      filters: [{ col: "id", op: "=", value: "other" }],
    });
    expect(res.status).toBe(200);
    expect(mocks.fromSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "configuration",
        table: "users",
        filters: [
          { col: "id", op: "=", value: "other" },
          { col: "id", op: "=", value: "user-1" },
        ],
      })
    );
  });

  it("meneruskan query yang diizinkan ke QueryBuilder", async () => {
    mockDb("recruitment", "hrd");
    mocks.grantedCodes.mockResolvedValue(["hris.recruitment.candidates"]);
    const res = await post({ table: "candidates", select: "*, brands(name), positions(title)" });
    expect(res.status).toBe(200);
    expect(mocks.fromSpec).toHaveBeenCalledWith(expect.objectContaining({ schema: "recruitment" }));
  });
});
