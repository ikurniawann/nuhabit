// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn(), update: vi.fn() }));

/** Rantai shim minimal: select().eq().eq().single() dan update().eq().eq(). */
function chain(result: () => unknown) {
  const node: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) node[m] = () => node;
  node.single = () => Promise.resolve(result());
  node.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return node;
}

vi.mock("@/lib/pg/create-client", () => ({
  createServerPgClient: async () => ({ auth: { getUser: mocks.getUser } }),
  createPgClient: () => ({
    from: () => ({
      select: () => chain(mocks.single),
      update: (values: unknown) => {
        mocks.update(values);
        return chain(() => ({ error: null }));
      },
    }),
  }),
}));

import { GET, PATCH } from "./route";

const url = (qs: string) => `http://localhost/api/ai/assistant${qs}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.c" } } });
});

describe("/api/ai/assistant", () => {
  it("GET tanpa sesi login → 401", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(new NextRequest(url("?list=true")))).status).toBe(401);
  });

  it("GET sesi milik orang lain → 404", async () => {
    mocks.single.mockReturnValue({ data: null });
    const res = await GET(new NextRequest(url("?session_id=s-lain")));
    expect(res.status).toBe(404);
  });

  it("PATCH judul kosong → 400 tanpa update", async () => {
    const res = await PATCH(
      new NextRequest(url("?session_id=s1"), { method: "PATCH", body: JSON.stringify({ title: "  " }) })
    );
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("PATCH memotong judul ke 120 karakter", async () => {
    const res = await PATCH(
      new NextRequest(url("?session_id=s1"), { method: "PATCH", body: JSON.stringify({ title: "a".repeat(200) }) })
    );
    expect(res.status).toBe(200);
    expect((mocks.update.mock.calls[0][0] as { title: string }).title).toHaveLength(120);
  });
});
