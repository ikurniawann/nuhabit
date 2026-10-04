import { describe, expect, it } from "vitest";
import {
  audienceWhere,
  challengePhase,
  challengeProgress,
  checkQrToken,
  evaluateBooking,
  isLateCancel,
  isMemberQrToken,
  leaderboardName,
  pickWaitlistPromotion,
} from "./rules";

const now = new Date("2026-10-03T10:00:00Z");
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

describe("checkQrToken", () => {
  it("accepts a fresh, unused token", () => {
    expect(checkQrToken({ expires_at: hoursFromNow(0.01), consumed_at: null }, now)).toBeNull();
  });
  it("names why a token is refused", () => {
    expect(checkQrToken(null, now)).toBe("not_found");
    expect(checkQrToken({ expires_at: hoursFromNow(1), consumed_at: now }, now)).toBe("consumed");
    expect(checkQrToken({ expires_at: hoursFromNow(-0.01), consumed_at: null }, now)).toBe("expired");
  });
  it("recognises member QR payloads regardless of case", () => {
    expect(isMemberQrToken(" BCDQR_abc ")).toBe(true);
    expect(isMemberQrToken("nhqr_abc")).toBe(true);
    expect(isMemberQrToken(" NHQR_abc ")).toBe(true);
    expect(isMemberQrToken("nh_abc")).toBe(false);
    expect(isMemberQrToken("04A1B2C3")).toBe(false);
  });
});

describe("evaluateBooking", () => {
  const event = { status: "published", starts_at: hoursFromNow(48), capacity: 2, booking_closes_hours: 2 };
  const base = { event, confirmedCount: 0, lastWaitlistPosition: 0, hasActiveBooking: false, now };

  it("confirms while seats remain", () => {
    expect(evaluateBooking(base)).toEqual({ kind: "confirm" });
  });
  it("waitlists behind the last position once full", () => {
    expect(evaluateBooking({ ...base, confirmedCount: 2, lastWaitlistPosition: 3 })).toEqual({
      kind: "waitlist",
      position: 4,
    });
  });
  it("refuses drafts, closed windows, started events and double bookings", () => {
    expect(evaluateBooking({ ...base, event: { ...event, status: "draft" } })).toMatchObject({ reason: "event_not_open" });
    expect(evaluateBooking({ ...base, event: { ...event, starts_at: hoursFromNow(1) } })).toMatchObject({
      reason: "booking_closed",
    });
    expect(evaluateBooking({ ...base, event: { ...event, starts_at: hoursFromNow(-1) } })).toMatchObject({
      reason: "event_started",
    });
    expect(evaluateBooking({ ...base, hasActiveBooking: true })).toMatchObject({ reason: "already_booked" });
  });
});

describe("waitlist and cancellation", () => {
  it("promotes the lowest position first, then the earliest signup", () => {
    const pick = pickWaitlistPromotion([
      { id: "a", status: "waitlist", waitlist_position: 2, created_at: "2026-10-01T00:00:00Z" },
      { id: "b", status: "waitlist", waitlist_position: 1, created_at: "2026-10-02T00:00:00Z" },
      { id: "c", status: "confirmed", waitlist_position: null, created_at: "2026-09-01T00:00:00Z" },
    ]);
    expect(pick?.id).toBe("b");
    expect(pickWaitlistPromotion([])).toBeNull();
  });
  it("flags a cancellation inside the deadline as late", () => {
    expect(isLateCancel({ starts_at: hoursFromNow(1), cancel_deadline_hours: 2 }, now)).toBe(true);
    expect(isLateCancel({ starts_at: hoursFromNow(5), cancel_deadline_hours: 2 }, now)).toBe(false);
  });
});

describe("challenges", () => {
  it("caps progress at 100% and marks completion at the target", () => {
    expect(challengeProgress(3, 5)).toMatchObject({ pct: 60, completed: false });
    expect(challengeProgress(7, 5)).toMatchObject({ pct: 100, completed: true });
  });
  it("places now inside the challenge window", () => {
    expect(challengePhase({ starts_at: hoursFromNow(1), ends_at: hoursFromNow(9) }, now)).toBe("upcoming");
    expect(challengePhase({ starts_at: hoursFromNow(-1), ends_at: hoursFromNow(9) }, now)).toBe("running");
    expect(challengePhase({ starts_at: hoursFromNow(-9), ends_at: hoursFromNow(-1) }, now)).toBe("ended");
  });
  it("shortens leaderboard names to first name and last initial", () => {
    expect(leaderboardName("Rina Ayu Pratiwi")).toBe("Rina P.");
    expect(leaderboardName("Budi")).toBe("Budi");
    expect(leaderboardName(null)).toBe("Member");
  });
});

describe("audienceWhere", () => {
  it("targets every active member without filters", () => {
    expect(audienceWhere({})).toEqual({ sql: "c.is_active IS NOT FALSE", params: [] });
  });
  it("numbers parameters in filter order", () => {
    const where = audienceWhere({ tier_codes: ["gold"], min_visits: 5, inactive_days: 30 });
    expect(where.params).toEqual([["gold"], 5, 30]);
    expect(where.sql).toContain("= ANY($1)");
    expect(where.sql).toContain(">= $2");
    expect(where.sql).toContain("days => $3");
  });
});
