import { describe, expect, it } from "vitest";
import { canWriteNote, notesForRoster } from "./session-notes";

describe("catatan coach setelah sesi", () => {
  it("ditulis hari sesi s/d 7 hari sesudahnya, bukan untuk sesi mendatang", () => {
    expect(canWriteNote("2026-10-22", "2026-10-22")).toBe(true);
    expect(canWriteNote("2026-10-15", "2026-10-22")).toBe(true);
    expect(canWriteNote("2026-10-14", "2026-10-22")).toBe(false);
    expect(canWriteNote("2026-10-23", "2026-10-22")).toBe(false);
    expect(canWriteNote("2026-12-31", "2027-01-02")).toBe(true);
  });

  it("roster: semua yang dibawa dulu (terbaru dulu), lalu riwayat terbaru maks 3", () => {
    const n = (id: string, pinned: boolean, at: string) => ({ id, pinned, created_at: at });
    const out = notesForRoster([
      n("old-pin", true, "2026-08-01T00:00:00Z"),
      n("h1", false, "2026-10-20T00:00:00Z"),
      n("h2", false, "2026-10-18T00:00:00Z"),
      n("new-pin", true, "2026-10-21T00:00:00Z"),
      n("h3", false, "2026-10-10T00:00:00Z"),
      n("h4", false, "2026-10-01T00:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["new-pin", "old-pin", "h1", "h2", "h3"]);
  });
});
