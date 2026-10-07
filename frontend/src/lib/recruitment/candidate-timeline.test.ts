import { describe, expect, it } from "vitest";
import { buildCandidateTimelines, daysInStage } from "./candidate-timeline";

describe("buildCandidateTimelines", () => {
  it("memisahkan catatan dan aktivitas, tanpa duplikasi note_added", () => {
    const { noteEntries, activityEntries } = buildCandidateTimelines(
      [{ id: "n1", content: "Kandidat ramah", created_by_name: null, created_at: "2026-10-01T00:00:00Z" }],
      [
        { id: "a1", activity_type: "note_added", description: "Catatan ditambahkan", created_at: "2026-10-01T00:00:00Z" },
        { id: "a2", activity_type: "status_change", description: "Tahap diubah", created_by_name: "Rina", created_at: "2026-10-02T00:00:00Z" },
      ]
    );
    expect(noteEntries).toEqual([
      { id: "note-n1", kind: "note", text: "Kandidat ramah", author: "HR", at: "2026-10-01T00:00:00Z" },
    ]);
    expect(activityEntries.map((e) => [e.id, e.author])).toEqual([["act-a2", "Rina"]]);
  });
});

describe("daysInStage", () => {
  it("membulatkan ke atas dan tidak negatif", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    expect(daysInStage("2026-10-03T00:00:00Z", now)).toBe(2);
    expect(daysInStage("2026-10-05T00:00:00Z", now)).toBe(0);
  });
});
