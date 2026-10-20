import { describe, expect, it } from "vitest";
import { bookedSeats, fillLabel, sessionsByDay } from "./coach-schedule";

describe("sessionsByDay", () => {
  it("groups by WIB day in start order", () => {
    const groups = sessionsByDay([
      { id: "c", starts_at: "2026-10-21T01:00:00.000Z" },
      { id: "b", starts_at: "2026-10-20T17:30:00.000Z" }, // 00.30 WIB on the 21st
      { id: "a", starts_at: "2026-10-20T03:00:00.000Z" },
    ]);
    expect(groups.map((g) => [g.day, g.sessions.map((s) => s.id)])).toEqual([
      ["2026-10-20", ["a"]],
      ["2026-10-21", ["b", "c"]],
    ]);
  });

  it("is empty without sessions", () => {
    expect(sessionsByDay([])).toEqual([]);
  });
});

describe("fill", () => {
  it("counts no-shows as booked seats", () => {
    expect(bookedSeats({ confirmed_count: 6, no_show_count: 2 })).toBe(8);
  });

  it("labels a ratio as a whole percentage", () => {
    expect(fillLabel(0.734)).toBe("73%");
    expect(fillLabel(null)).toBe("—");
  });
});
