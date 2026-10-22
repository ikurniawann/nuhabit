import { describe, expect, it } from "vitest";
import { googleCalendarUrl, sessionCalendarUrl, toGoogleUtc } from "./calendar";

describe("Add to Google Calendar", () => {
  it("jam WIB dikirim sebagai UTC, termasuk lewat tengah malam UTC", () => {
    expect(toGoogleUtc("2026-10-23", "07:00")).toBe("20261023T000000Z");
    expect(toGoogleUtc("2026-10-23", "06:30:00")).toBe("20261022T233000Z");
    expect(toGoogleUtc("2026-12-31", "20:00")).toBe("20261231T130000Z");
  });

  it("link template berisi judul, rentang waktu, zona, lokasi, dan detail", () => {
    const url = new URL(
      googleCalendarUrl({ title: "Hyrox Engine", date: "2026-10-23", startTime: "07:00", endTime: "08:00", details: "Coach: Pras" })
    );
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Hyrox Engine");
    expect(url.searchParams.get("dates")).toBe("20261023T000000Z/20261023T010000Z");
    expect(url.searchParams.get("ctz")).toBe("Asia/Jakarta");
    expect(url.searchParams.get("location")).toBe("NüHabit Hyrox Studio");
    expect(url.searchParams.get("details")).toBe("Coach: Pras");
  });

  it("sesi: judul per jenis, alamat venue bila ada, catatan batal & tautan app", () => {
    const url = new URL(
      sessionCalendarUrl({
        programName: "Strength 1:1",
        kind: "pt",
        date: "2026-10-24",
        startTime: "09:00",
        endTime: "10:00",
        coachName: "Coach Rara",
        cancelWindowHours: 12,
        appUrl: "https://x/member",
        venue: { name: "NüHabit Hyrox Studio", address: "Jl. Kemang Raya 1, Jakarta" },
      })
    );
    expect(url.searchParams.get("text")).toBe("NüHabit · Personal Training — Strength 1:1");
    expect(url.searchParams.get("location")).toBe("NüHabit Hyrox Studio, Jl. Kemang Raya 1, Jakarta");
    const details = url.searchParams.get("details")!;
    expect(details).toContain("Coach: Coach Rara");
    expect(details).toContain("at least 12 hours before");
    expect(details).toContain("https://x/member");
    expect(
      new URL(sessionCalendarUrl({ programName: "Hyrox Engine", kind: "class", date: "2026-10-24", startTime: "06:00", endTime: "07:00", coachName: null, cancelWindowHours: 12, appUrl: "" })).searchParams.get("text")
    ).toBe("NüHabit · Hyrox Engine");
  });
});
