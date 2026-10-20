import { describe, expect, it } from "vitest";
import { localClock, localDay, localInstant, zoneAbbr, zoneName, zoneSuffix } from "./timezone";

describe("branch time zones", () => {
  // 16.30 UTC: 23.30 WIB on the 24th, 00.30 WITA and 01.30 WIT on the 25th.
  const instant = "2026-10-24T16:30:00.000Z";

  it("reads days and clocks in the branch zone, WIB by default", () => {
    expect(localDay(instant)).toBe("2026-10-24");
    expect(localDay(instant, "Asia/Makassar")).toBe("2026-10-25");
    expect(localDay(instant, "Asia/Jayapura")).toBe("2026-10-25");
    expect(localClock(instant, "Asia/Jayapura")).toBe("01:30");
    expect(localClock(instant, "Mars/Olympus")).toBe("23:30");
  });

  it("turns a local date and time back into the instant", () => {
    expect(localInstant("2026-10-25", "00:30", "Asia/Makassar").toISOString()).toBe(instant);
    expect(localInstant("2026-10-24", "23:30").toISOString()).toBe(instant);
  });

  it("names the zone and labels times outside WIB only", () => {
    expect([zoneAbbr(undefined), zoneAbbr("Asia/Makassar"), zoneAbbr("Asia/Jayapura")]).toEqual(["WIB", "WITA", "WIT"]);
    expect(zoneName(null)).toBe("Asia/Jakarta");
    expect(zoneSuffix("Asia/Jakarta")).toBe("");
    expect(zoneSuffix("Asia/Makassar")).toBe(" WITA");
  });
});
