import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, { failures: number; window_started_at: Date; locked_until: Date | null }>();
const key = (params: unknown[]) => `${params[0]}|${params[1]}`;

async function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.startsWith("INSERT")) {
    if (!store.has(key(params))) store.set(key(params), { failures: 0, window_started_at: new Date(), locked_until: null });
    return { rows: [] };
  }
  if (sql.includes("FOR UPDATE")) return { rows: [store.get(key(params))] };
  if (sql.startsWith("UPDATE")) {
    store.set(key(params), { failures: params[2] as number, window_started_at: params[3] as Date, locked_until: params[4] as Date | null });
    return { rows: [] };
  }
  return { rows: [] };
}

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT")) {
      const subjects = params[1] as string[];
      return subjects.map((s) => store.get(`${params[0]}|${s}`)).filter(Boolean);
    }
    if (sql.startsWith("DELETE FROM auth.attempt_limits WHERE scope")) {
      for (const s of params[1] as string[]) store.delete(`${params[0]}|${s}`);
    }
    return [];
  }),
  withTransaction: vi.fn(async (fn: (client: { query: typeof fakeQuery }) => unknown) => fn({ query: fakeQuery })),
}));

import {
  activeLock,
  applyFailure,
  clearFailures,
  findActiveLock,
  minutesUntil,
  recordFailure,
  type AttemptPolicy,
} from "./attempt-limit";

const policy: AttemptPolicy = { maxFailures: 3, windowMs: 10 * 60_000, lockoutMs: 15 * 60_000 };
const t0 = new Date("2026-10-04T10:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

describe("applyFailure (murni)", () => {
  it("kegagalan ke-max mengunci selama lockoutMs", () => {
    let state = applyFailure(null, t0, policy);
    state = applyFailure(state, at(1_000), policy);
    expect(activeLock(state, at(1_000))).toBeNull();
    state = applyFailure(state, at(2_000), policy);
    expect(state.failures).toBe(3);
    expect(activeLock(state, at(2_000))?.toISOString()).toBe(at(2_000 + policy.lockoutMs).toISOString());
  });

  it("jendela yang lewat memulai hitungan dari nol", () => {
    const old = applyFailure(applyFailure(null, t0, policy), at(1_000), policy);
    const next = applyFailure(old, at(policy.windowMs + 5_000), policy);
    expect(next.failures).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it("kunci yang sudah habis tidak berlaku lagi dan hitungan mulai ulang", () => {
    const locked = { failures: 3, windowStartedAt: t0, lockedUntil: at(60_000) };
    expect(activeLock(locked, at(61_000))).toBeNull();
    expect(applyFailure(locked, at(61_000), policy).failures).toBe(1);
  });

  it("minutesUntil dibulatkan ke atas, minimal 1", () => {
    expect(minutesUntil(at(61_000), t0)).toBe(2);
    expect(minutesUntil(at(1_000), t0)).toBe(1);
  });
});

describe("recordFailure / findActiveLock / clearFailures (DB)", () => {
  beforeEach(() => store.clear());

  it("hitungan bertahan di storage dan mengunci semua subject", async () => {
    expect(await recordFailure("pin", ["user:a", "order:1"], policy)).toBeNull();
    expect(await recordFailure("pin", ["user:a", "order:1"], policy)).toBeNull();
    const lock = await recordFailure("pin", ["user:a", "order:1"], policy);
    expect(lock).not.toBeNull();
    expect(await findActiveLock("pin", ["user:a"])).not.toBeNull();
    expect(await findActiveLock("pin", ["order:1"])).not.toBeNull();
    expect(await findActiveLock("pin", ["user:b"])).toBeNull();
  });

  it("sukses menghapus hitungan", async () => {
    await recordFailure("pin", ["user:a"], policy);
    await recordFailure("pin", ["user:a"], policy);
    await clearFailures("pin", ["user:a"]);
    expect(await recordFailure("pin", ["user:a"], policy)).toBeNull();
    expect(store.get("pin|user:a")?.failures).toBe(1);
  });
});
