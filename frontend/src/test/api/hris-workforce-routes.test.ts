/**
 * Validasi body PUT /api/hris/employees/[id]/shifts: pola jadwal harus 7 hari
 * dan transaksi tidak dibuka bila body tidak valid.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireIamMenuPrefix = vi.fn();
const getWorkforceActor = vi.fn();
const query = vi.fn();
const queryOne = vi.fn();
const withTransaction = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    requireIamMenuPrefix: (...args: unknown[]) => requireIamMenuPrefix(...args),
  };
});
vi.mock("@/lib/hris/workforce-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hris/workforce-auth")>();
  return { ...actual, getWorkforceActor: () => getWorkforceActor() };
});
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  withTransaction: (...args: unknown[]) => withTransaction(...args),
}));

const EMPLOYEE_ID = "00000000-0000-0000-0000-0000000000e1";
const HR_USER = { id: "u-hr", full_name: "HR Satu", role: "hrd", brand_id: null };

function req(url: string, method = "GET", body?: unknown) {
  const request = new Request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }) as Request & { nextUrl: URL };
  request.nextUrl = new URL(url);
  return request as never;
}

beforeEach(() => {
  for (const fn of [requireIamMenuPrefix, getWorkforceActor, query, queryOne, withTransaction]) fn.mockReset();
  requireIamMenuPrefix.mockResolvedValue(HR_USER);
  query.mockResolvedValue([]);
});

describe("PUT /api/hris/employees/[id]/shifts", () => {
  it("pola kurang dari 7 hari → 400", async () => {
    const { PUT } = await import("@/app/api/hris/employees/[id]/shifts/route");
    const res = await PUT(
      req("http://x", "PUT", { effective_from: "2026-10-05", days: [{ day_of_week: 1, shift_id: null }] }),
      { params: Promise.resolve({ id: EMPLOYEE_ID }) }
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Pola jadwal harus lengkap 7 hari (Senin–Minggu)");
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
