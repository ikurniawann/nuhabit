// PIN supervisor void/merge: hanya supervisor yang scope-nya mencakup order,
// order hilang/di luar scope = PIN salah, dan kegagalan dihitung di DB.
import { beforeEach, describe, expect, it, vi } from "vitest";

const users = new Map<string, Record<string, unknown>>();
const lock = { until: null as Date | null };
const recordFailure = vi.fn(async () => lock.until);
const clearFailures = vi.fn(async () => {});

vi.mock("@/lib/db", () => ({
  queryOne: vi.fn(async (_sql: string, params: unknown[]) => users.get(params[0] as string) ?? null),
  query: vi.fn(async () => [...users.values()].filter((u) => u.role === "pos_supervisor")),
}));
vi.mock("@/lib/security/attempt-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/attempt-limit")>()),
  findActiveLock: vi.fn(async () => lock.until),
  recordFailure: (...a: unknown[]) => recordFailure(...(a as [])),
  clearFailures: (...a: unknown[]) => clearFailures(...(a as [])),
}));

import type { BusinessScopeLevel } from "@/lib/configuration/business-scope";
import { approveOrderWithSupervisorPin, supervisorsForOrder } from "./supervisor-pin-server";

const branchA = { company_id: "co-1", branch_id: "br-a" };
const branchB = { company_id: "co-1", branch_id: "br-b" };
const user = (id: string, role: string, scope: BusinessScopeLevel | null, branch: typeof branchA, pin: string | null = null) => ({
  id, role, business_scope: scope, holding_id: null, full_name: id, pos_pin: pin, ...branch,
});

beforeEach(() => {
  users.clear();
  lock.until = null;
  vi.clearAllMocks();
  users.set("kasir-a", user("kasir-a", "pos", "branch", branchA));
  users.set("spv-a", user("spv-a", "pos_supervisor", "branch", branchA, "1111"));
  users.set("spv-b", user("spv-b", "pos_supervisor", "branch", branchB, "2222"));
});

describe("supervisorsForOrder", () => {
  it("supervisor cabang lain tidak ikut, supervisor company & tanpa scope ikut", () => {
    const list = [
      user("a", "pos_supervisor", "branch", branchA),
      user("b", "pos_supervisor", "branch", branchB),
      user("c", "pos_supervisor", "company", { company_id: "co-1", branch_id: null as unknown as string }),
      user("d", "pos_supervisor", "company", { company_id: "co-2", branch_id: null as unknown as string }),
      user("e", "pos_supervisor", null, branchB),
    ];
    expect(supervisorsForOrder(list, branchA).map((s) => s.id)).toEqual(["a", "c", "e"]);
  });
});

describe("approveOrderWithSupervisorPin", () => {
  const approve = (pin: string, order: typeof branchA | null = branchA, callerId = "kasir-a") =>
    approveOrderWithSupervisorPin({ callerId, orderId: "ord-1", order, pin });

  it("PIN supervisor cabang order → disetujui, hitungan dibersihkan", async () => {
    const result = await approve("1111");
    expect(result).toEqual({ ok: true, supervisor: { id: "spv-a", name: "spv-a" } });
    expect(clearFailures).toHaveBeenCalledWith("pos_supervisor_pin", ["user:kasir-a", "order:ord-1"]);
  });

  it("PIN supervisor cabang LAIN ditolak dan dihitung gagal", async () => {
    expect(await approve("2222")).toEqual({ ok: false, reason: "invalid" });
    expect(recordFailure).toHaveBeenCalledWith(
      "pos_supervisor_pin",
      ["user:kasir-a", "order:ord-1"],
      expect.objectContaining({ maxFailures: 5 })
    );
  });

  it("order hilang dijawab sama dengan PIN salah (PIN benar pun)", async () => {
    expect(await approve("1111", null)).toEqual({ ok: false, reason: "invalid" });
    expect(recordFailure).toHaveBeenCalled();
  });

  it("order di luar scope kasir dijawab sama dengan PIN salah", async () => {
    users.set("spv-b2", user("spv-b2", "pos_supervisor", "branch", branchB, "3333"));
    expect(await approve("3333", branchB)).toEqual({ ok: false, reason: "invalid" });
  });

  it("terkunci → PIN tidak dicek sama sekali", async () => {
    lock.until = new Date(Date.now() + 10 * 60_000);
    expect(await approve("1111")).toEqual({ ok: false, reason: "locked", retryMinutes: 10 });
    expect(clearFailures).not.toHaveBeenCalled();
  });
});
