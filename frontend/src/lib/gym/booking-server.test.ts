// @vitest-environment node
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const credits = vi.hoisted(() => ({
  getCreditBalance: vi.fn(),
  deductCredits: vi.fn(),
  getCoveredClassTypeIds: vi.fn(),
}));
const notifyMember = vi.hoisted(() => vi.fn());

vi.mock("@/lib/gym/credits-server", () => credits);
vi.mock("@/lib/gym/rules", async () => {
  const actual = await vi.importActual<typeof import("./rules")>("./rules");
  return { ...actual, getGymRules: vi.fn(async () => actual.GYM_RULE_DEFAULTS) };
});
vi.mock("@/lib/crm/engagement/server", () => ({ notifyMember }));

import { bookSession, checkInBooking, SchedulingError } from "./booking-server";

/** Client palsu: setiap query dicocokkan ke handler pertama yang pola SQL-nya cocok. */
function fakeClient(handlers: Array<[RegExp, (params: unknown[]) => unknown[]]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const handler = handlers.find(([pattern]) => pattern.test(sql));
    return { rows: handler ? handler[1](params) : [], rowCount: 1 };
  });
  return { client: { query } as unknown as PoolClient, calls };
}

const NOW = new Date("2026-10-05T10:50:00Z");
const candidate = {
  id: "bk1",
  session_id: "s1",
  credit_cost: 2,
  starts_at: new Date("2026-10-05T11:00:00Z"),
  class_name: "Race Simulation",
};

beforeEach(() => {
  vi.clearAllMocks();
  credits.getCreditBalance.mockResolvedValue(5);
  credits.getCoveredClassTypeIds.mockResolvedValue(null);
});

describe("checkInBooking", () => {
  const gate = (overrides: { candidate?: unknown; lastEntry?: Date | null } = {}) =>
    fakeClient([
      [/FROM pos\.pos_customers/, () => [{ name: "Rani", is_active: true }]],
      [/max\(created_at\)/, () => [{ at: overrides.lastEntry ?? null }]],
      [/FROM gym\.bookings b/, () => ("candidate" in overrides ? [overrides.candidate].filter(Boolean) : [candidate])],
    ]);

  it("booking terkonfirmasi: kredit dipotong idempoten, booking check-in, log + notifikasi", async () => {
    credits.deductCredits.mockResolvedValue({ ok: true, balanceAfter: 3 });
    const { client, calls } = gate();
    const result = await checkInBooking(client, { customerId: "m1", scannedBy: "u1", token: "bcdqr_x", now: NOW });

    expect(result).toMatchObject({
      decision: "allowed",
      entryKind: "booking",
      creditsDeducted: 2,
      balanceAfter: 3,
      message: "Check-in Race Simulation · 2 kredit dipotong · sisa 3 kredit",
    });
    expect(credits.deductCredits).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ customerId: "m1", amount: 2, sourceId: "bk1", idempotencyKey: "gym:checkin:bk1" })
    );
    expect(calls.some((c) => /SET consumed_at/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /SET status = 'checked_in'/.test(c.sql))).toBe(true);
    const logged = calls.find((c) => /INSERT INTO gym\.access_logs/.test(c.sql));
    expect(logged?.params.slice(3, 7)).toEqual(["allowed", null, "booking", -2]);
    expect(notifyMember).toHaveBeenCalledOnce();
  });

  it("tanpa booking: ditolak 'Tidak ada booking kelas', tanpa potongan", async () => {
    const { client, calls } = gate({ candidate: null });
    const result = await checkInBooking(client, { customerId: "m1", scannedBy: null, source: "pos", now: NOW });
    expect(result).toMatchObject({ decision: "denied", reason: "no_booking", message: "Tidak ada booking kelas" });
    expect(credits.deductCredits).not.toHaveBeenCalled();
    expect(calls.some((c) => /checked_in/.test(c.sql) && /UPDATE/.test(c.sql))).toBe(false);
  });

  it("saldo habis di antara baca dan potong: gate tetap tertutup", async () => {
    credits.deductCredits.mockResolvedValue({ ok: false, reason: "insufficient" });
    const { client, calls } = gate();
    const result = await checkInBooking(client, { customerId: "m1", scannedBy: null, now: NOW });
    expect(result).toMatchObject({ decision: "denied", reason: "insufficient_credits", creditsDeducted: 0 });
    expect(calls.some((c) => /SET status = 'checked_in'/.test(c.sql))).toBe(false);
  });

  it("kredit dari paket yang tidak mencakup kelas ini: ditolak saldo kurang", async () => {
    credits.getCoveredClassTypeIds.mockResolvedValue(["t-other"]);
    const { client } = gate({ candidate: { ...candidate, class_type_id: "t-sim" } });
    const result = await checkInBooking(client, { customerId: "m1", scannedBy: null, now: NOW });
    expect(result).toMatchObject({ decision: "denied", reason: "insufficient_credits" });
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it("masuk ulang dalam masa tenggang: gratis", async () => {
    // Booking-nya sudah check-in, jadi tidak ada booking terkonfirmasi tersisa.
    const { client } = gate({ lastEntry: new Date(NOW.getTime() - 5 * 60_000), candidate: null });
    const result = await checkInBooking(client, { customerId: "m1", scannedBy: null, now: NOW });
    expect(result).toMatchObject({ decision: "allowed", entryKind: "re_entry", creditsDeducted: 0 });
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });
});

describe("bookSession", () => {
  const session = {
    id: "s1",
    class_type_id: "t1",
    class_type_name: "Engine Builder",
    branch_id: null,
    status: "published",
    capacity: 1,
    credit_cost: 1,
    starts_at: new Date("2026-10-06T00:00:00Z"),
    booking_opens_at: new Date("2026-09-29T00:00:00Z"),
    booking_closes_at: new Date("2026-10-06T00:00:00Z"),
  };
  const booking = (stats: { confirmed: number; last_waitlist: number; mine: boolean }) =>
    fakeClient([
      [/FOR UPDATE OF s/, () => [{ ...session }]],
      [/SELECT is_active/, () => [{ is_active: true }]],
      [/last_waitlist/, () => [stats]],
      [/INSERT INTO gym\.bookings/, () => [{ id: "bk9" }]],
      [/count\(\*\)::int AS n/, () => [{ n: stats.confirmed + 1 }]],
    ]);

  it("kursi terakhir: terkonfirmasi dan sesi menjadi penuh", async () => {
    const { client, calls } = booking({ confirmed: 0, last_waitlist: 0, mine: false });
    const result = await bookSession(client, { customerId: "m1", sessionId: "s1", source: "member", now: NOW });
    expect(result).toEqual({ bookingId: "bk9", status: "confirmed", waitlistPosition: null });
    expect(calls.find((c) => /SET status = \$2/.test(c.sql))?.params).toEqual(["s1", "full"]);
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it("penuh: masuk waitlist di posisi berikutnya", async () => {
    const { client } = booking({ confirmed: 1, last_waitlist: 2, mine: false });
    const result = await bookSession(client, { customerId: "m1", sessionId: "s1", source: "member", now: NOW });
    expect(result).toMatchObject({ status: "waitlist", waitlistPosition: 3 });
  });

  it("paket tidak mencakup jenis kelas: ditolak", async () => {
    credits.getCoveredClassTypeIds.mockResolvedValue(["t-other"]);
    const { client } = booking({ confirmed: 0, last_waitlist: 0, mine: false });
    await expect(
      bookSession(client, { customerId: "m1", sessionId: "s1", source: "member", now: NOW })
    ).rejects.toThrow("Paket kredit Anda tidak mencakup kelas ini");
  });

  it("penolakan membawa pesan Indonesia dan kode alasan", async () => {
    credits.getCreditBalance.mockResolvedValue(0);
    const { client } = booking({ confirmed: 0, last_waitlist: 0, mine: false });
    const error = await bookSession(client, { customerId: "m1", sessionId: "s1", source: "member", now: NOW }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(SchedulingError);
    expect(error).toMatchObject({ message: "Kredit tidak cukup untuk kelas ini", status: 409, code: "insufficient_credits" });
  });
});
