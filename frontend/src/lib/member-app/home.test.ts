import { describe, expect, it } from "vitest";
import { notificationKind, pickGateBooking, pickRailDay, promoLabel, raceImage } from "./home";

describe("notificationKind", () => {
  it.each([
    ["gym_booking_confirmed", "BOOKING_CONFIRMED"],
    ["booking_confirmed", "BOOKING_CONFIRMED"],
    ["gym_booking_reminder", "BOOKING_REMINDER"],
    ["gym_waitlist_promoted", "WAITLIST_PROMOTED"],
    ["gym_waitlist_offer", "WAITLIST_PROMOTED"],
    ["booking_waitlist", "WAITLIST_PROMOTED"],
    ["wallet_low_balance", "LOW_BALANCE"],
    ["wallet_expiring", "CREDIT_EXPIRY"],
    ["wallet_expired", "CREDIT_EXPIRY"],
    ["gym_checked_in", "VISIT_LOGGED"],
    ["visit_recorded", "VISIT_LOGGED"],
    ["gym_session_moved", "SESSION_CHANGED"],
    ["gym_session_cancelled", "SESSION_CHANGED"],
    ["gym_booking_cancelled", "SESSION_CHANGED"],
    ["announcement", "ANNOUNCEMENT"],
    ["promo", "ANNOUNCEMENT"],
    ["review_reply", "OTHER"],
  ])("%s → %s", (type, kind) => {
    expect(notificationKind(type)).toBe(kind);
  });
});

describe("promoLabel", () => {
  it("formats percent and rupiah discounts", () => {
    expect(promoLabel("percent", 10)).toBe("10% OFF");
    expect(promoLabel("fixed", 100000)).toBe("Rp100.000 OFF");
  });
});

describe("pickRailDay", () => {
  // 2026-10-03 10:00 WIB
  const now = new Date("2026-10-03T03:00:00Z");
  const at = (iso: string) => ({ startsAt: iso });

  it("keeps today's classes that have not started", () => {
    const result = pickRailDay(
      [at("2026-10-03T01:00:00Z"), at("2026-10-03T05:00:00Z"), at("2026-10-04T01:00:00Z")],
      now
    );
    expect(result.railDay).toBe("TODAY");
    expect(result.sessions).toEqual([at("2026-10-03T05:00:00Z")]);
  });

  it("switches to tomorrow once today is over, using the WIB calendar", () => {
    // 2026-10-03 20:00 WIB; 2026-10-03T18:00Z is already 4 Oct 01:00 WIB.
    const evening = new Date("2026-10-03T13:00:00Z");
    const result = pickRailDay(
      [at("2026-10-03T12:00:00Z"), at("2026-10-03T18:00:00Z"), at("2026-10-05T01:00:00Z")],
      evening
    );
    expect(result).toEqual({ railDay: "TOMORROW", sessions: [at("2026-10-03T18:00:00Z")] });
  });
});

describe("pickGateBooking", () => {
  const now = new Date("2026-10-03T10:00:00Z").getTime();
  const booking = (status: string, startsAt: string, endsAt: string) => ({
    booking: { status },
    session: { startsAt, endsAt },
  });

  it("returns the class whose check-in window is open now", () => {
    const live = booking("CONFIRMED", "2026-10-03T10:30:00Z", "2026-10-03T11:30:00Z");
    const later = booking("CONFIRMED", "2026-10-03T15:00:00Z", "2026-10-03T16:00:00Z");
    expect(pickGateBooking([later, live], now)).toEqual({ booking: live, live: true });
  });

  it("falls back to the next confirmed class", () => {
    const later = booking("CONFIRMED", "2026-10-03T15:00:00Z", "2026-10-03T16:00:00Z");
    const waitlist = booking("WAITLIST", "2026-10-03T12:00:00Z", "2026-10-03T13:00:00Z");
    expect(pickGateBooking([waitlist, later], now)).toEqual({ booking: later, live: false });
  });

  it("keeps a checked-in class live for re-entry", () => {
    const inClass = booking("CHECKED_IN", "2026-10-03T09:30:00Z", "2026-10-03T10:30:00Z");
    expect(pickGateBooking([inClass], now)).toEqual({ booking: inClass, live: true });
  });

  it("returns null without a confirmed class", () => {
    expect(pickGateBooking([booking("WAITLIST", "2026-10-03T12:00:00Z", "2026-10-03T13:00:00Z")], now)).toBeNull();
  });
});

describe("raceImage", () => {
  it("prefers the admin race image, else the bundled city photo", () => {
    expect(raceImage("https://cdn/x.jpg", "Jakarta")).toBe("https://cdn/x.jpg");
    expect(raceImage(null, "Kuala Lumpur")).toBe("/member-assets/img/race-kualalumpur.jpg");
    expect(raceImage(null, "Bandung")).toBeNull();
  });
});
