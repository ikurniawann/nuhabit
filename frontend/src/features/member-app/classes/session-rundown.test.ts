import { describe, expect, it } from "vitest";
import { sessionRundown } from "./session-rundown";

describe("sessionRundown", () => {
  const start = "2026-10-05T01:00:00.000Z";

  it("scales the class template to the real duration, segments back to back", () => {
    const items = sessionRundown("cls_sim", start, "2026-10-05T02:30:00.000Z");
    expect(items.map((i) => i.label)).toEqual(["Briefing & lane setup", "Warm-up", "Full race simulation", "Cooldown"]);
    expect(items.reduce((s, i) => s + i.minutes, 0)).toBe(90);
    expect(items[0]!.startsAt.toISOString()).toBe(start);
    expect(items[1]!.startsAt.getTime() - items[0]!.startsAt.getTime()).toBe(items[0]!.minutes * 60_000);
  });

  it("falls back to the default template for unknown class keys", () => {
    const items = sessionRundown("unknown", start, "2026-10-05T02:00:00.000Z");
    expect(items[2]!.label).toBe("Main workout");
    expect(items.reduce((s, i) => s + i.minutes, 0)).toBe(60);
  });
});
