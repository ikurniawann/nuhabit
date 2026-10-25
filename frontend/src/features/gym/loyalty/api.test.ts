import { describe, expect, it } from "vitest";
import { minutesToTime, perkLines, timeToMinutes } from "./api";

describe("gym loyalty helpers", () => {
  it("converts off-peak times both ways", () => {
    expect(minutesToTime(600)).toBe("10:00");
    expect(minutesToTime(1440)).toBe("24:00");
    expect(timeToMinutes("06:30")).toBe(390);
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("24:30")).toBeNull();
    expect(timeToMinutes("7.30")).toBeNull();
  });

  it("lists the perks the system applies", () => {
    expect(perkLines({ discount_percent: 10, early_booking_days: 2, cancel_window_hours: 2, waitlist_priority: true })).toEqual([
      "Diskon POS & F&B 10%",
      "Booking dibuka 2 hari lebih awal",
      "Batal gratis sampai 2 jam sebelum kelas",
      "Prioritas waitlist",
    ]);
    expect(perkLines({ discount_percent: 0, early_booking_days: 0, cancel_window_hours: null, waitlist_priority: false })).toEqual([]);
  });
});
