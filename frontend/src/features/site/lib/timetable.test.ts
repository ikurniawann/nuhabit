import { describe, expect, it } from "vitest";
import { addDays, clampWeek, groupByDay, mondayOf, sessionHref, weekDays, weekWindow, weekdayIndex, wibDay } from "./timetable";

const session = (id: string, starts_at: string) => ({
  id,
  starts_at,
  ends_at: starts_at,
  duration_min: 60,
  class_type: { name: "Engine", color: "lime" },
  coach_name: null,
  capacity: 12,
  seats_left: 3,
  waitlist_open: false,
});

describe("timetable weeks", () => {
  it("finds the Monday of a WIB day", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(weekdayIndex("2026-10-11")).toBe(6);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("opens the window on this week in WIB and closes it eight weeks later", () => {
    // 23:30 UTC on Saturday is already Sunday 06:30 in WIB.
    const window = weekWindow(new Date("2026-10-10T23:30:00Z"));
    expect(window).toEqual({ first: "2026-10-05", last: "2026-11-30" });
    expect(clampWeek("2026-09-28", window)).toBe("2026-10-05");
    expect(clampWeek("2026-12-07", window)).toBe("2026-11-30");
    expect(clampWeek("2026-10-19", window)).toBe("2026-10-19");
  });

  it("groups sessions into the week's seven WIB days in start order", () => {
    const groups = groupByDay(
      [
        session("b", "2026-10-07T11:30:00.000Z"),
        session("a", "2026-10-07T10:30:00.000Z"),
        // 17:30 UTC on Thursday is Friday 00:30 in WIB.
        session("c", "2026-10-08T17:30:00.000Z"),
        session("x", "2026-10-12T01:00:00.000Z"),
      ],
      "2026-10-05",
    );
    expect([...groups.keys()]).toEqual(weekDays("2026-10-05"));
    expect(groups.get("2026-10-07")?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(groups.get("2026-10-09")?.map((s) => s.id)).toEqual(["c"]);
    expect(groups.get("2026-10-08")).toEqual([]);
    expect(wibDay("2026-10-08T17:30:00.000Z")).toBe("2026-10-09");
  });

  it("links each session into the member app", () => {
    expect(sessionHref("abc-1")).toBe("/member/classes/abc-1");
  });
});
