import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "./api";
import { dayLabel, groupByDay, monthGrid, monthLabel, queryRange, shiftAnchor, shiftMonth, weekDays, weekLabel } from "./calendar";

function entry(id: string, starts_at: string, timezone = "Asia/Jakarta"): CalendarEntry {
  return {
    kind: "class",
    id,
    title: id,
    starts_at,
    ends_at: starts_at,
    branch_id: null,
    branch_name: null,
    timezone,
    area: null,
    coach_id: null,
    coach_name: null,
    status: "published",
    updated_at: starts_at,
    crm_event_id: null,
    site_event_id: null,
    organiser_user_id: null,
    capacity: null,
    confirmed: null,
  };
}

describe("monthGrid", () => {
  it("covers November 2026 from Monday 26 Oct to Sunday 6 Dec in six rows", () => {
    const rows = monthGrid("2026-11");
    expect(rows).toHaveLength(6);
    expect(rows[0][0]).toBe("2026-10-26");
    expect(rows[5][6]).toBe("2026-12-06");
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });

  it("starts a month that begins on Monday without a leading week", () => {
    const rows = monthGrid("2026-06");
    expect(rows[0][0]).toBe("2026-06-01");
    expect(rows).toHaveLength(5);
  });
});

describe("weeks and shifting", () => {
  it("builds the Monday to Sunday week around any day", () => {
    expect(weekDays("2026-11-05")).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(weekDays("2026-11-08")[0]).toBe("2026-11-02");
  });

  it("shifts months across a year boundary", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftAnchor("month", "2026-11-17", 1)).toBe("2026-12-01");
    expect(shiftAnchor("week", "2026-11-17", -1)).toBe("2026-11-10");
    expect(shiftAnchor("day", "2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("queryRange", () => {
  it("spans the visible grid in WIB", () => {
    expect(queryRange("month", "2026-11-17")).toEqual({ from: "2026-10-25T17:00:00.000Z", to: "2026-12-06T17:00:00.000Z" });
    expect(queryRange("day", "2026-11-02")).toEqual({ from: "2026-11-01T17:00:00.000Z", to: "2026-11-02T17:00:00.000Z" });
  });
});

describe("groupByDay", () => {
  it("files entries under their branch's local day, sorted by start", () => {
    const grouped = groupByDay([
      entry("late", "2026-11-02T16:30:00Z"),
      entry("early", "2026-11-02T01:00:00Z"),
      entry("wita", "2026-11-02T16:30:00Z", "Asia/Makassar"),
    ]);
    expect(grouped.get("2026-11-02")?.map((e) => e.id)).toEqual(["early", "late"]);
    expect(grouped.get("2026-11-03")?.map((e) => e.id)).toEqual(["wita"]);
  });
});

describe("labels", () => {
  it("renders Indonesian month, day and week labels", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(dayLabel("2026-11-02")).toBe("Senin, 2 November 2026");
    expect(weekLabel("2026-11-05")).toBe("2–8 November 2026");
    expect(weekLabel("2026-11-30")).toBe("30 November – 6 Desember 2026");
    expect(weekLabel("2026-12-30")).toBe("28 Desember 2026 – 3 Januari 2027");
  });
});
