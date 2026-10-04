import { describe, expect, it } from "vitest";
import { conversationSearchParams } from "./api";
import { conversationTitle, relativeTime, withDateSeparators } from "./inbox-format";
import type { InboxMessage } from "./types";

const message = (id: string, created_at: string): InboxMessage => ({
  id,
  direction: "in",
  message_type: "text",
  body: "hai",
  media_type: null,
  status: "received",
  error_reason: null,
  wa_from_me: false,
  created_at,
  sent_by_name: null,
});

describe("inbox format", () => {
  it("titles a conversation by customer, profile, then channel id", () => {
    const base = { customer_name: null, display_name: null, external_id: "62812" };
    expect(conversationTitle({ ...base, channel: "whatsapp" })).toBe("+62812");
    expect(conversationTitle({ ...base, channel: "instagram" })).toBe("62812");
    expect(conversationTitle({ ...base, channel: "whatsapp", display_name: "Budi" })).toBe("Budi");
    expect(conversationTitle({ ...base, channel: "whatsapp", display_name: "Budi", customer_name: "Sari" })).toBe("Sari");
  });

  it("formats relative time buckets", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("2026-10-04T11:59:40Z", now)).toBe("baru saja");
    expect(relativeTime("2026-10-04T11:15:00Z", now)).toBe("45m");
    expect(relativeTime("2026-10-04T02:00:00Z", now)).toBe("10j");
    expect(relativeTime("2026-10-01T02:00:00Z", now)).toBe("1 Okt 2026");
  });

  it("labels only the first message of each WIB day", () => {
    const rows = withDateSeparators([
      message("a", "2026-10-03T10:00:00Z"),
      message("b", "2026-10-03T16:00:00Z"), // 23.00 WIB, masih 3 Okt
      message("c", "2026-10-03T17:30:00Z"), // 00.30 WIB, 4 Okt
    ]);
    expect(rows.map((r) => r.dateLabel)).toEqual(["3 Okt 2026", null, "4 Okt 2026"]);
  });

  it("builds conversation query params without 'all' filters", () => {
    expect(conversationSearchParams({ status: "all", assigned: "all", channel: "all", search: "  " })).toBe("");
    expect(conversationSearchParams({ status: "open", assigned: "me", channel: "whatsapp", search: " budi " })).toBe(
      "status=open&assigned=me&channel=whatsapp&search=budi"
    );
  });
});
