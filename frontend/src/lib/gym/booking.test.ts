import { describe, expect, it } from "vitest";
import {
  bookingStatusOnComplete,
  canTransitionBooking,
  canTransitionSession,
  deriveBookingWindow,
  describeGateDecision,
  evaluateBookingEligibility,
  evaluateCancellation,
  evaluateGateScan,
  isWithinCheckInWindow,
  nextWaitlistPosition,
  noShowPenalty,
  pickWaitlistPromotion,
  planWaitlistPromotion,
  sessionStatusForSeats,
  shiftDays,
  weekStartWib,
  type BookableSession,
  type SchedulingRules,
  type WaitlistEntry,
} from "./booking";

const RULES: SchedulingRules = {
  cancellationDeadlineHours: 4,
  lateCancelPolicy: "forfeit",
  noShowPolicy: "forfeit",
  reEntryGraceMin: 15,
  antiPassbackMin: 60,
  waitlistAutoPromote: true,
  bookingOpensDaysBefore: 7,
  bookingClosesMinBefore: 0,
};

const START = "2026-10-05T11:00:00.000Z"; // Senin 18.00 WIB
const NOW = new Date("2026-10-04T10:00:00.000Z");

const session = (over: Partial<BookableSession> = {}): BookableSession => ({
  status: "published",
  capacity: 2,
  credit_cost: 2,
  booking_opens_at: "2026-09-28T11:00:00.000Z",
  booking_closes_at: START,
  ...over,
});

const eligibility = (over: Partial<Parameters<typeof evaluateBookingEligibility>[0]> = {}) =>
  evaluateBookingEligibility({
    memberActive: true,
    session: session(),
    balance: 5,
    confirmedCount: 0,
    lastWaitlistPosition: 0,
    hasActiveBooking: false,
    now: NOW,
    ...over,
  });

describe("state machine sesi & booking", () => {
  it("sesi: draft → published → full → published, completed/cancelled final", () => {
    expect(canTransitionSession("draft", "published")).toBe(true);
    expect(canTransitionSession("published", "full")).toBe(true);
    expect(canTransitionSession("full", "published")).toBe(true);
    expect(canTransitionSession("draft", "completed")).toBe(false);
    expect(canTransitionSession("completed", "published")).toBe(false);
    expect(canTransitionSession("cancelled", "published")).toBe(false);
  });

  it("booking: confirmed bisa check-in/no-show/batal, waitlist hanya naik/batal", () => {
    expect(canTransitionBooking("confirmed", "checked_in")).toBe(true);
    expect(canTransitionBooking("confirmed", "no_show")).toBe(true);
    expect(canTransitionBooking("waitlist", "confirmed")).toBe(true);
    expect(canTransitionBooking("waitlist", "checked_in")).toBe(false);
    expect(canTransitionBooking("checked_in", "cancelled")).toBe(false);
    expect(canTransitionBooking("no_show", "checked_in")).toBe(false);
  });

  it("status penuh mengikuti kursi terisi", () => {
    expect(sessionStatusForSeats("published", 2, 2)).toBe("full");
    expect(sessionStatusForSeats("full", 1, 2)).toBe("published");
    expect(sessionStatusForSeats("published", 1, 2)).toBe("published");
    expect(sessionStatusForSeats("draft", 5, 2)).toBe("draft");
    expect(sessionStatusForSeats("completed", 0, 2)).toBe("completed");
  });

  it("jendela booking: buka N hari sebelum, tutup M menit sebelum mulai", () => {
    const w = deriveBookingWindow(START, { bookingOpensDaysBefore: 7, bookingClosesMinBefore: 30 });
    expect(w.opensAt.toISOString()).toBe("2026-09-28T11:00:00.000Z");
    expect(w.closesAt.toISOString()).toBe("2026-10-05T10:30:00.000Z");
  });
});

describe("evaluateBookingEligibility (urutan referensi)", () => {
  it("member tidak aktif ditolak lebih dulu dari apa pun", () => {
    expect(eligibility({ memberActive: false, balance: 0, hasActiveBooking: true })).toEqual({
      kind: "deny",
      reason: "member_not_active",
    });
  });

  it("sesi draft/selesai/batal tidak bisa di-booking; penuh masih bisa (waitlist)", () => {
    for (const status of ["draft", "completed", "cancelled"] as const) {
      expect(eligibility({ session: session({ status }) })).toEqual({ kind: "deny", reason: "session_not_bookable" });
    }
    expect(eligibility({ session: session({ status: "full" }), confirmedCount: 2 }).kind).toBe("waitlist");
  });

  it("di luar jendela booking ditolak", () => {
    expect(eligibility({ now: new Date("2026-09-27T00:00:00Z") })).toEqual({
      kind: "deny",
      reason: "booking_not_open_yet",
    });
    expect(eligibility({ now: new Date("2026-10-05T11:00:01Z") })).toEqual({
      kind: "deny",
      reason: "booking_window_closed",
    });
  });

  it("booking aktif ganda ditolak sebelum cek saldo", () => {
    expect(eligibility({ hasActiveBooking: true, balance: 0 })).toEqual({ kind: "deny", reason: "already_booked" });
  });

  it("saldo kurang dari biaya kredit ditolak, juga untuk waitlist", () => {
    expect(eligibility({ balance: 1 })).toEqual({ kind: "deny", reason: "insufficient_credits" });
    expect(eligibility({ balance: 1, confirmedCount: 2 })).toEqual({ kind: "deny", reason: "insufficient_credits" });
  });

  it("kursi tersisa → konfirmasi; penuh → waitlist di posisi berikutnya", () => {
    expect(eligibility({ balance: 2, confirmedCount: 1 })).toEqual({ kind: "confirm" });
    expect(eligibility({ confirmedCount: 2, lastWaitlistPosition: 3 })).toEqual({ kind: "waitlist", position: 4 });
  });
});

describe("pembatalan & no-show", () => {
  const cancel = (now: string, over: Partial<Parameters<typeof evaluateCancellation>[0]> = {}) =>
    evaluateCancellation({ bookingStatus: "confirmed", startsAt: START, creditCost: 2, rules: RULES, now: new Date(now), ...over });

  it("sebelum batas: gratis", () => {
    const out = cancel("2026-10-05T06:59:00Z");
    expect(out).toMatchObject({ late: false, penaltyCredits: 0 });
    expect(out.deadline.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });

  it("setelah batas + forfeit: kredit sesi hangus", () => {
    expect(cancel("2026-10-05T07:00:01Z")).toMatchObject({ late: true, penaltyCredits: 2 });
  });

  it("setelah batas + free: tercatat terlambat tanpa potongan", () => {
    expect(cancel("2026-10-05T10:00:00Z", { rules: { ...RULES, lateCancelPolicy: "free" } })).toMatchObject({
      late: true,
      penaltyCredits: 0,
    });
  });

  it("melepas waitlist selalu gratis", () => {
    expect(cancel("2026-10-05T10:59:00Z", { bookingStatus: "waitlist" })).toMatchObject({ late: false, penaltyCredits: 0 });
  });

  it("no-show mengikuti kebijakan", () => {
    expect(noShowPenalty(2, RULES)).toBe(2);
    expect(noShowPenalty(2, { noShowPolicy: "free" })).toBe(0);
  });

  it("saat sesi selesai: check-in → completed, confirmed → no_show, waitlist → cancelled", () => {
    expect(bookingStatusOnComplete("checked_in")).toBe("completed");
    expect(bookingStatusOnComplete("confirmed")).toBe("no_show");
    expect(bookingStatusOnComplete("waitlist")).toBe("cancelled");
    expect(bookingStatusOnComplete("cancelled")).toBe("cancelled");
  });
});

describe("waitlist FIFO", () => {
  const rows: WaitlistEntry[] = [
    { id: "c", status: "waitlist", waitlist_position: 2, created_at: "2026-10-01T00:00:00Z" },
    { id: "x", status: "confirmed", waitlist_position: null, created_at: "2026-09-01T00:00:00Z" },
    { id: "b", status: "waitlist", waitlist_position: 1, created_at: "2026-10-02T00:00:00Z" },
    { id: "a", status: "waitlist", waitlist_position: 1, created_at: "2026-10-01T12:00:00Z" },
  ];

  it("posisi terkecil menang, seri dipecah waktu daftar", () => {
    expect(pickWaitlistPromotion(rows)?.id).toBe("a");
  });

  it("antrean yang sudah ditawari dilewati", () => {
    const offered = rows.map((r) => (r.id === "a" ? { ...r, promotion_offered_at: "2026-10-03T00:00:00Z" } : r));
    expect(pickWaitlistPromotion(offered)?.id).toBe("b");
  });

  it("antrean kosong → null; posisi berikutnya = maks + 1", () => {
    expect(pickWaitlistPromotion([rows[1]])).toBeNull();
    expect(nextWaitlistPosition(rows)).toBe(3);
    expect(nextWaitlistPosition([])).toBe(1);
  });

  it("mode promosi mengikuti aturan auto-promote", () => {
    expect(planWaitlistPromotion(rows, { waitlistAutoPromote: true })).toMatchObject({ mode: "auto", booking: { id: "a" } });
    expect(planWaitlistPromotion(rows, { waitlistAutoPromote: false })).toMatchObject({ mode: "offer" });
    expect(planWaitlistPromotion([], RULES)).toBeNull();
  });
});

describe("evaluateGateScan", () => {
  const scan = (over: Partial<Parameters<typeof evaluateGateScan>[0]> = {}) =>
    evaluateGateScan({
      tokenProblem: null,
      memberActive: true,
      lastAllowedEntryAt: null,
      candidate: { bookingId: "bk1", creditCost: 2 },
      balance: 3,
      rules: RULES,
      now: NOW,
      ...over,
    });

  it("token bermasalah ditolak tanpa efek apa pun", () => {
    expect(scan({ tokenProblem: "not_found" })).toMatchObject({ decision: "denied", reason: "token_invalid", effects: [] });
    expect(scan({ tokenProblem: "expired" }).reason).toBe("token_expired");
    expect(scan({ tokenProblem: "consumed" }).reason).toBe("token_consumed");
  });

  it("member tidak aktif ditolak, token tetap hangus", () => {
    expect(scan({ memberActive: false })).toEqual({
      decision: "denied",
      reason: "member_not_active",
      entryKind: null,
      effects: [{ kind: "consume_token" }],
    });
  });

  it("dalam masa tenggang: masuk ulang gratis tanpa potong kredit", () => {
    const out = scan({ lastAllowedEntryAt: new Date(NOW.getTime() - 10 * 60_000), candidate: null });
    expect(out).toMatchObject({ decision: "allowed", entryKind: "re_entry" });
    expect(out.effects).toEqual([{ kind: "consume_token" }]);
  });

  it("lewat tenggang tapi dalam anti-passback: ditolak", () => {
    expect(scan({ lastAllowedEntryAt: new Date(NOW.getTime() - 30 * 60_000), candidate: null }).reason).toBe("anti_passback");
  });

  it("kelas berurutan: booking yang belum check-in didahulukan dari re-entry dan anti-passback", () => {
    for (const minsAgo of [10, 30]) {
      const out = scan({ lastAllowedEntryAt: new Date(NOW.getTime() - minsAgo * 60_000) });
      expect(out).toMatchObject({ decision: "allowed", entryKind: "booking" });
      expect(out.effects).toContainEqual({ kind: "check_in_booking", bookingId: "bk1" });
    }
  });

  it("lewat anti-passback: dinilai seperti scan biasa", () => {
    expect(scan({ lastAllowedEntryAt: new Date(NOW.getTime() - 61 * 60_000) }).entryKind).toBe("booking");
  });

  it("tanpa booking kelas: ditolak (tidak ada open gym)", () => {
    expect(scan({ candidate: null })).toMatchObject({ decision: "denied", reason: "no_booking" });
  });

  it("saldo kurang: ditolak", () => {
    expect(scan({ balance: 1 }).reason).toBe("insufficient_credits");
  });

  it("booking + saldo cukup: konsumsi token, potong kredit, check-in booking", () => {
    expect(scan()).toEqual({
      decision: "allowed",
      reason: null,
      entryKind: "booking",
      effects: [
        { kind: "consume_token" },
        { kind: "deduct_credits", amount: 2 },
        { kind: "check_in_booking", bookingId: "bk1" },
      ],
    });
  });

  it("token yang sudah divalidasi pemanggil (undefined) langsung lanjut", () => {
    expect(scan({ tokenProblem: undefined }).decision).toBe("allowed");
  });

  it("kalimat keputusan menjelaskan hasilnya", () => {
    expect(describeGateDecision({ decision: "denied", reason: "no_booking", entryKind: null })).toBe(
      "Tidak ada booking kelas"
    );
    expect(describeGateDecision({ decision: "allowed", reason: null, entryKind: "re_entry" })).toMatch(/tanpa potong/);
    expect(
      describeGateDecision(
        { decision: "allowed", reason: null, entryKind: "booking" },
        { className: "Engine Builder", credits: 1, balanceAfter: 4 }
      )
    ).toBe("Check-in Engine Builder · 1 kredit dipotong · sisa 4 kredit");
  });
});

describe("jendela check-in & minggu", () => {
  const s = { starts_at: START, ends_at: "2026-10-05T12:00:00.000Z" };
  it("45 menit sebelum mulai sampai 15 menit setelah selesai", () => {
    expect(isWithinCheckInWindow(s, new Date("2026-10-05T10:15:00Z"))).toBe(true);
    expect(isWithinCheckInWindow(s, new Date("2026-10-05T10:14:59Z"))).toBe(false);
    expect(isWithinCheckInWindow(s, new Date("2026-10-05T12:15:00Z"))).toBe(true);
    expect(isWithinCheckInWindow(s, new Date("2026-10-05T12:15:01Z"))).toBe(false);
  });

  it("awal minggu (Senin WIB) dan geser hari", () => {
    expect(weekStartWib(new Date("2026-10-03T05:00:00Z"))).toBe("2026-09-28"); // Sabtu
    expect(weekStartWib(new Date("2026-10-04T18:00:00Z"))).toBe("2026-10-05"); // Senin 01.00 WIB
    expect(weekStartWib(new Date("2026-10-04T16:59:00Z"))).toBe("2026-09-28"); // Minggu 23.59 WIB
    expect(shiftDays(START, 7).toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });
});
