import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../lib/lang";
import { formatDay, formatDayTime } from "./format";

const TUESDAY = "2026-11-03T12:00:00Z";

describe("dates follow the app language", () => {
  afterEach(() => setLang("id"));

  it("reads Indonesian", () => {
    setLang("id");
    expect(formatDay(TUESDAY, "Asia/Jakarta")).toMatch(/^Sel,? 3 Nov$/);
    expect(formatDayTime(TUESDAY, "Asia/Jakarta")).toContain("19.00");
  });

  it("reads English", () => {
    setLang("en");
    expect(formatDay(TUESDAY, "Asia/Jakarta")).toMatch(/^Tue,? 3 Nov$/);
    expect(formatDayTime(TUESDAY, "Asia/Jakarta")).toContain("19:00");
  });
});
