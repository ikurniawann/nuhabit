import { describe, expect, it } from "vitest";
import {
  computeCoachStatement,
  computeLine,
  decidePayoutAction,
  isPeriodMonth,
  monthPeriod,
  rateFor,
  resolveScheme,
  type IncentiveScheme,
  type StatementSession,
} from "./incentive";

const scheme = (over: Partial<IncentiveScheme> = {}): IncentiveScheme => ({
  id: "default",
  coachId: null,
  isDefault: true,
  sessionFeeIdr: 150_000,
  perAttendeeIdr: 15_000,
  fullClassBonusIdr: 50_000,
  fullClassThresholdPercent: 80,
  noShowPenaltyIdr: 0,
  rates: [],
  isActive: true,
  ...over,
});

const session = (over: Partial<StatementSession> = {}): StatementSession => ({
  id: "s1",
  coachId: "coach-a",
  classTypeId: "fundamentals",
  classTypeName: "HYROX Fundamentals",
  startsAt: "2026-09-10T00:00:00Z",
  capacity: 10,
  status: "completed",
  bookingStatuses: [],
  ...over,
});

const repeat = <T,>(value: T, n: number): T[] => Array.from({ length: n }, () => value);

describe("resolveScheme / rateFor", () => {
  const coachScheme = scheme({ id: "coach", coachId: "coach-a", isDefault: false, sessionFeeIdr: 200_000 });

  it("prefers an active coach scheme over the default", () => {
    expect(resolveScheme(scheme(), coachScheme).id).toBe("coach");
    expect(resolveScheme(scheme(), { ...coachScheme, isActive: false }).id).toBe("default");
    expect(resolveScheme(scheme(), null).id).toBe("default");
  });

  it("uses the class-type rate when one exists", () => {
    const s = scheme({ rates: [{ classTypeId: "race-sim", sessionFeeIdr: 300_000, perAttendeeIdr: 25_000 }] });
    expect(rateFor(s, "race-sim")).toEqual({ classTypeId: "race-sim", sessionFeeIdr: 300_000, perAttendeeIdr: 25_000 });
    expect(rateFor(s, "mobility")).toEqual({ classTypeId: "mobility", sessionFeeIdr: 150_000, perAttendeeIdr: 15_000 });
  });
});

describe("computeLine", () => {
  it("pays fee plus attendees, counting checked_in and completed as attended", () => {
    const line = computeLine(
      scheme(),
      session({ bookingStatuses: ["checked_in", "completed", "confirmed", "cancelled", "waitlist", "no_show"] })
    );
    expect(line).toMatchObject({ booked: 4, attended: 2, noShows: 1, attendeeIdr: 30_000, bonusIdr: 0, totalIdr: 180_000 });
  });

  it("adds the full-class bonus at the threshold, not below", () => {
    expect(computeLine(scheme(), session({ bookingStatuses: repeat("checked_in", 8) })).bonusIdr).toBe(50_000);
    expect(computeLine(scheme(), session({ bookingStatuses: repeat("checked_in", 7) })).bonusIdr).toBe(0);
  });

  it("never pays a bonus for a zero-capacity class", () => {
    expect(computeLine(scheme({ fullClassThresholdPercent: 0 }), session({ capacity: 0 })).bonusIdr).toBe(0);
  });

  it("deducts no-shows and clamps the line at zero", () => {
    const harsh = scheme({ sessionFeeIdr: 50_000, perAttendeeIdr: 0, noShowPenaltyIdr: 30_000 });
    const line = computeLine(harsh, session({ bookingStatuses: repeat("no_show", 3) }));
    expect(line.penaltyIdr).toBe(90_000);
    expect(line.totalIdr).toBe(0);
  });

  it("applies class-type overrides to fee and per-attendee pay", () => {
    const s = scheme({ rates: [{ classTypeId: "fundamentals", sessionFeeIdr: 100_000, perAttendeeIdr: 20_000 }] });
    const line = computeLine(s, session({ bookingStatuses: repeat("checked_in", 3) }));
    expect(line).toMatchObject({ sessionFeeIdr: 100_000, attendeeIdr: 60_000, totalIdr: 160_000 });
  });
});

describe("computeCoachStatement", () => {
  const sessions: StatementSession[] = [
    session({ id: "late", startsAt: "2026-09-20T00:00:00Z", bookingStatuses: repeat("checked_in", 8) }),
    session({ id: "early", startsAt: "2026-09-02T00:00:00Z", bookingStatuses: ["checked_in", "no_show"] }),
    session({ id: "other-coach", coachId: "coach-b" }),
    session({ id: "cancelled", status: "cancelled" }),
    session({ id: "published", status: "published" }),
    // 1 Okt 06:00 WIB = 30 Sep 23:00 UTC → periode Oktober.
    session({ id: "october-wib", startsAt: "2026-09-30T23:00:00Z" }),
    // 1 Sep 00:30 WIB = 31 Agu 17:30 UTC → periode September.
    session({ id: "september-wib", startsAt: "2026-08-31T17:30:00Z" }),
  ];
  const statement = computeCoachStatement({
    coachId: "coach-a",
    periodMonth: "2026-09",
    scheme: scheme({ noShowPenaltyIdr: 10_000 }),
    sessions,
  });

  it("keeps only the coach's completed classes inside the WIB month, oldest first", () => {
    expect(statement.lines.map((l) => l.sessionId)).toEqual(["september-wib", "early", "late"]);
  });

  it("totals the lines", () => {
    // september-wib: 150k; early: 150k + 15k − 10k = 155k; late: 150k + 120k + 50k = 320k.
    expect(statement.totals).toEqual({
      sessions: 3,
      attended: 9,
      noShows: 1,
      sessionFeeIdr: 450_000,
      attendeeIdr: 135_000,
      bonusIdr: 50_000,
      penaltyIdr: 10_000,
      totalIdr: 625_000,
    });
    expect(statement).toMatchObject({ coachId: "coach-a", periodMonth: "2026-09", schemeId: "default" });
  });

  it("is empty for a coach with no classes", () => {
    const empty = computeCoachStatement({ coachId: "nobody", periodMonth: "2026-09", scheme: scheme(), sessions });
    expect(empty.lines).toEqual([]);
    expect(empty.totals.totalIdr).toBe(0);
  });
});

describe("periods", () => {
  it("bounds a month in WIB", () => {
    expect(monthPeriod("2026-09")).toEqual({ start: "2026-08-31T17:00:00.000Z", end: "2026-09-30T17:00:00.000Z" });
    expect(monthPeriod("2026-12").end).toBe("2026-12-31T17:00:00.000Z");
  });
  it("rejects malformed periods", () => {
    expect(isPeriodMonth("2026-13")).toBe(false);
    expect(isPeriodMonth("2026-9")).toBe(false);
    expect(() => monthPeriod("bad")).toThrow();
  });
});

describe("decidePayoutAction", () => {
  it("walks draft → approved → paid", () => {
    expect(decidePayoutAction("draft", "approve")).toEqual({ ok: true, status: "approved", paymentReference: null, note: null });
    expect(decidePayoutAction("approved", "pay", { paymentReference: " TRF-0925 " })).toEqual({
      ok: true,
      status: "paid",
      paymentReference: "TRF-0925",
      note: null,
    });
  });

  it("requires a payment reference to pay and a note to void", () => {
    expect(decidePayoutAction("approved", "pay", { paymentReference: "  " })).toEqual({
      ok: false,
      error: "Referensi pembayaran wajib diisi.",
    });
    expect(decidePayoutAction("draft", "void")).toEqual({ ok: false, error: "Alasan pembatalan wajib diisi." });
    expect(decidePayoutAction("approved", "void", { note: "Salah hitung" })).toMatchObject({ ok: true, status: "void" });
  });

  it("refuses illegal moves", () => {
    expect(decidePayoutAction("draft", "pay", { paymentReference: "x" }).ok).toBe(false);
    expect(decidePayoutAction("paid", "void", { note: "x" }).ok).toBe(false);
    expect(decidePayoutAction("void", "approve").ok).toBe(false);
  });
});
