// Daftar & tambah kandidat: guard dulu, query parametris, validasi body.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const query = vi.fn();
const queryOne = vi.fn();
const requireIamMenuPrefix = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...a: unknown[]) => query(...a),
  queryOne: (...a: unknown[]) => queryOne(...a),
  getPool: vi.fn(),
}));
vi.mock("@/lib/api/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/auth")>()),
  requireIamMenuPrefix: (...a: unknown[]) => requireIamMenuPrefix(...a),
}));

const req = (url: string, body?: unknown) =>
  new Request(`http://x${url}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) as unknown as NextRequest;

let userSeq = 0;
beforeEach(() => {
  query.mockReset().mockResolvedValue([]);
  queryOne.mockReset().mockResolvedValue({ total: 0 });
  // user baru per test supaya kuota rate limit tidak terbawa
  requireIamMenuPrefix.mockReset().mockResolvedValue({ id: `u${++userSeq}`, full_name: "HR", role: "hrd" });
});

describe("GET /api/candidates", () => {
  it("tanpa grant: 403 dan database tidak disentuh", async () => {
    const { ApiError } = await import("@/lib/api/auth");
    requireIamMenuPrefix.mockRejectedValue(ApiError.forbidden());
    const { GET } = await import("./route");
    expect((await GET(req("/api/candidates"))).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("filter jadi parameter SQL dan meta paging dihitung", async () => {
    query.mockResolvedValue([{ id: "c1" }]);
    queryOne.mockResolvedValue({ total: 41 });
    const { GET } = await import("./route");
    const res = await GET(req("/api/candidates?status=screening&search=sari&page=2"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.meta).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3, hasNextPage: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("c.status = $1");
    expect(params).toEqual(["screening", "%sari%", 20, 20]);
  });

  it("parameter tidak valid: 400", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("/api/candidates?limit=1000"));
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });
});

describe("POST /api/candidates", () => {
  it("menyimpan kandidat dengan created_by dari sesi", async () => {
    queryOne.mockResolvedValue({ id: "new" });
    const { POST } = await import("./route");
    const res = await POST(
      req("/api/candidates", { full_name: "Sari", email: "s@x.id", phone: "081234567890", domicile: "Bdg" })
    );
    expect(res.status).toBe(201);
    const params = queryOne.mock.calls[0][1] as unknown[];
    expect(params.at(-1)).toBe(`u${userSeq}`);
    expect(params.slice(0, 5)).toEqual(["Sari", "s@x.id", "081234567890", "Bdg", "walk_in"]);
  });

  it("body tidak valid: 400 berpesan isu pertama", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("/api/candidates", { full_name: "S", email: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Nama minimal 2 karakter");
    expect(queryOne).not.toHaveBeenCalled();
  });
});
