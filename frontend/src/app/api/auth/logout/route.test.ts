// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), jar: new Map<string, string>() }));

vi.mock("@/lib/db", () => ({ query: mocks.query, queryOne: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name)! } : undefined),
  }),
}));

import { GET, POST } from "./route";

const sha = (token: string) => createHash("sha256").update(token).digest("hex");
const deletedHashes = () =>
  mocks.query.mock.calls
    .filter(([sql]) => String(sql).includes("DELETE FROM auth.sessions"))
    .map(([, params]) => (params as string[])[0]);
const expired = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0/.test(c))
    .map((c) => c.split("=")[0]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
});

describe("/api/auth/logout", () => {
  it("POST menghapus sesi cookie baru dan lama, lalu mengosongkan kedua cookie", async () => {
    mocks.jar.set("nuhabit_session", "tok-baru");
    mocks.jar.set("arkiv_session", "tok-lama");
    const res = await POST(new Request("https://dashboard.test/api/auth/logout", { method: "POST" }));

    expect(res.status).toBe(200);
    expect(deletedHashes().sort()).toEqual([sha("tok-baru"), sha("tok-lama")].sort());
    expect(expired(res)).toEqual(
      expect.arrayContaining(["nuhabit_session", "arkiv_session", "arkiv-active-stall"])
    );
  });

  it("POST dengan cookie lama saja tetap menghapus sesinya", async () => {
    mocks.jar.set("arkiv_session", "tok-lama");
    await POST(new Request("https://dashboard.test/api/auth/logout", { method: "POST" }));
    expect(deletedHashes()).toEqual([sha("tok-lama")]);
  });

  it("GET tanpa cookie mengalihkan ke /login tanpa query DB", async () => {
    const res = await GET(new Request("https://dashboard.test/api/auth/logout"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
