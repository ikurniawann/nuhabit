import { describe, it, expect } from "vitest";
import { sortNotifications, timeAgo } from "./notification-time";

describe("timeAgo", () => {
  const now = new Date("2026-10-04T12:00:00Z").getTime();
  it("uses relative labels within a week", () => {
    expect(timeAgo("2026-10-04T11:59:40Z", now)).toBe("Baru saja");
    expect(timeAgo("2026-10-04T11:55:00Z", now)).toBe("5 menit lalu");
    expect(timeAgo("2026-10-04T09:00:00Z", now)).toBe("3 jam lalu");
    expect(timeAgo("2026-10-02T12:00:00Z", now)).toBe("2 hari lalu");
  });

  it("falls back to a calendar date after a week", () => {
    expect(timeAgo("2026-09-20T05:00:00Z", now)).toBe("20 Sep 2026");
  });
});

describe("sortNotifications", () => {
  it("puts unread first, newest first", () => {
    const items = [
      { id: "a", is_read: true, created_at: "2026-10-04T10:00:00Z" },
      { id: "b", is_read: false, created_at: "2026-10-01T10:00:00Z" },
      { id: "c", is_read: false, created_at: "2026-10-03T10:00:00Z" },
    ];
    expect(sortNotifications(items).map((n) => n.id)).toEqual(["c", "b", "a"]);
  });
});
