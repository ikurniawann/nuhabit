import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, activeDeadline, deadlineText, hoursText, listQuery, rateText, reporterName } from "./api";

describe("complaint list helpers", () => {
  it("builds the list query without empty filters", () => {
    expect(listQuery(EMPTY_FILTERS, 0)).toBe("status=active&limit=25&offset=0");
    expect(listQuery({ ...EMPTY_FILTERS, status: "", owner: "me", overdue: true, q: "  KEL-2610 " }, 2)).toBe(
      "owner=me&q=KEL-2610&overdue=1&limit=25&offset=50"
    );
  });

  it("names the reporter", () => {
    expect(reporterName({ member_name: "Rina", contact_name: "x", contact_phone: null })).toBe("Rina");
    expect(reporterName({ member_name: null, contact_name: null, contact_phone: "0812" })).toBe("0812");
    expect(reporterName({ member_name: null, contact_name: null, contact_phone: null })).toBe("-");
  });

  it("picks the running deadline", () => {
    const t = { respond_by: "2026-10-27T03:00:00.000Z", resolve_by: "2026-10-29T03:00:00.000Z" };
    expect(activeDeadline({ ...t, status: "received", first_response_at: null })).toEqual({ kind: "respond", at: t.respond_by });
    expect(activeDeadline({ ...t, status: "in_progress", first_response_at: "2026-10-27T01:00:00.000Z" })).toEqual({ kind: "resolve", at: t.resolve_by });
    expect(activeDeadline({ ...t, status: "resolved", first_response_at: null })).toBeNull();
  });

  it("writes time left and overdue", () => {
    const now = new Date("2026-10-27T00:00:00.000Z");
    expect(deadlineText("2026-10-27T03:00:00.000Z", now)).toBe("3 jam lagi");
    expect(deadlineText("2026-10-26T23:30:00.000Z", now)).toBe("lewat 30 menit");
    expect(deadlineText("2026-10-24T00:00:00.000Z", now)).toBe("lewat 3 hari");
  });

  it("formats report figures", () => {
    expect(hoursText(null)).toBe("-");
    expect(hoursText(0.5)).toBe("30 mnt");
    expect(hoursText(5.5)).toBe("5,5 jam");
    expect(hoursText(72)).toBe("3 hari");
    expect(rateText(0.25)).toBe("25%");
    expect(rateText(0.1234)).toBe("12,3%");
    expect(rateText(null)).toBe("-");
  });
});
