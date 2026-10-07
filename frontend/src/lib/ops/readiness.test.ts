import { describe, expect, it, vi } from "vitest";
import { checkDatabaseReady } from "./readiness";

describe("checkDatabaseReady", () => {
  it("siap bila SELECT 1 berhasil", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const result = await checkDatabaseReady(() => ({ query }));
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });

  it("tidak siap bila query gagal", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const result = await checkDatabaseReady(() => ({ query }));
    expect(result).toMatchObject({ ok: false, error: "connect ECONNREFUSED" });
  });

  it("tidak siap bila pool belum bisa dibuat", async () => {
    const result = await checkDatabaseReady(() => {
      throw new Error("DATABASE_URL belum diset");
    });
    expect(result).toMatchObject({ ok: false, error: "DATABASE_URL belum diset" });
  });

  it("tidak siap bila database menggantung melewati batas waktu", async () => {
    const query = () => new Promise(() => {});
    const result = await checkDatabaseReady(() => ({ query }), 20);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/20 ms/);
  });
});

describe("GET /api/ready", () => {
  it("mengembalikan 503 saat database tidak tersedia", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getPool: () => ({ query: () => Promise.reject(new Error("down")) }),
    }));
    const { GET } = await import("@/app/api/ready/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "unavailable", error: "down" });
    vi.doUnmock("@/lib/db");
  });

  it("mengembalikan 200 saat database menjawab", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      getPool: () => ({ query: () => Promise.resolve({ rows: [] }) }),
    }));
    const { GET } = await import("@/app/api/ready/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready", database: "ok" });
    vi.doUnmock("@/lib/db");
  });
});
