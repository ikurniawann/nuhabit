import { describe, expect, it } from "vitest";
import { googleCalendarEventUrl } from "./google-calendar";

describe("googleCalendarEventUrl", () => {
  it("uses the session's actual UTC times and includes the branch", () => {
    const href = googleCalendarEventUrl({
      title: "HYROX Strength",
      startsAt: "2026-10-09T07:00:00+07:00",
      endsAt: "2026-10-09T08:00:00+07:00",
      branchName: "NüHabit Sulu Bandung",
      coachName: "Rani",
    });
    const url = new URL(href!);
    expect(url.searchParams.get("dates")).toBe("20261009T000000Z/20261009T010000Z");
    expect(url.searchParams.get("location")).toBe("NüHabit Sulu Bandung");
    expect(url.searchParams.get("details")).toContain("Coach: Rani");
  });

  it("rejects invalid or reversed times", () => {
    expect(googleCalendarEventUrl({ title: "A", startsAt: "bad", endsAt: "2026-10-09T08:00:00Z" })).toBeNull();
    expect(googleCalendarEventUrl({ title: "A", startsAt: "2026-10-09T08:00:00Z", endsAt: "2026-10-09T07:00:00Z" })).toBeNull();
  });
});
