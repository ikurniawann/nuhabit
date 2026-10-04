// @vitest-environment node
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

const getGymRules = vi.hoisted(() => vi.fn(async (_db: unknown, branchId: string | null) => ({ branchId })));

vi.mock("@/lib/gym/rules", () => ({ getGymRules }));
vi.mock("@/lib/gym/credits-server", () => ({ getCreditBalance: vi.fn(), deductCredits: vi.fn() }));

import { ApiError } from "@/lib/api/auth";
import { branchRules, SchedulingError } from "./booking-store";

describe("branchRules", () => {
  it("membaca aturan sekali per cabang selama satu operasi", async () => {
    const db = {} as PoolClient;
    const rulesFor = branchRules(db);
    const [a, b, c] = await Promise.all([rulesFor("br-1"), rulesFor("br-1"), rulesFor(null)]);
    expect(a).toBe(b);
    expect(c).toEqual({ branchId: null });
    expect(getGymRules).toHaveBeenCalledTimes(2);
  });
});

describe("SchedulingError", () => {
  it("adalah ApiError: default 409, membawa kode alasan", () => {
    const error = new SchedulingError("Kelas penuh", undefined, "session_full");
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "Kelas penuh", code: "session_full", name: "SchedulingError" });
  });
});
