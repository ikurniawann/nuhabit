import { describe, expect, it } from "vitest";
import type { Session } from "./api";
import { dropInSessions } from "./drop-in";

const now = Date.parse("2026-10-20T11:00:00Z");
const session = (id: string, startsAt: string, endsAt: string, status: Session["status"] = "published") =>
  ({ id, starts_at: startsAt, ends_at: endsAt, status }) as Session;

describe("dropInSessions", () => {
  it("keeps running sessions and those starting within the hour", () => {
    const rows = [
      session("running", "2026-10-20T10:30:00Z", "2026-10-20T11:30:00Z"),
      session("soon", "2026-10-20T11:45:00Z", "2026-10-20T12:45:00Z"),
      session("full", "2026-10-20T10:50:00Z", "2026-10-20T11:50:00Z", "full"),
    ];
    expect(dropInSessions(rows, now).map((s) => s.id)).toEqual(["running", "soon", "full"]);
  });

  it("drops ended, later, draft and cancelled sessions", () => {
    const rows = [
      session("ended", "2026-10-20T09:00:00Z", "2026-10-20T10:00:00Z"),
      session("later", "2026-10-20T13:00:00Z", "2026-10-20T14:00:00Z"),
      session("draft", "2026-10-20T10:30:00Z", "2026-10-20T11:30:00Z", "draft"),
      session("cancelled", "2026-10-20T10:30:00Z", "2026-10-20T11:30:00Z", "cancelled"),
    ];
    expect(dropInSessions(rows, now)).toEqual([]);
  });
});
