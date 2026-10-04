import path from "path";
import { describe, expect, it } from "vitest";
import { isWithinPrefix, safeSegments, safeSegmentsUnder } from "./safe-path";

describe("safeSegments", () => {
  it("accepts ordinary file segments", () => {
    expect(safeSegments(["attendance", "emp-1", "123-abc.jpg"])).toEqual([
      "attendance",
      "emp-1",
      "123-abc.jpg",
    ]);
  });

  it.each([
    [["attendance", "..", "x.jpg"]],
    [["attendance", ".", "x.jpg"]],
    [["attendance", ".hidden"]],
    [["attendance", ""]],
    [[]],
  ])("rejects dot, empty and missing segments %j", (segments) => {
    expect(safeSegments(segments)).toBeNull();
  });

  it("rejects a segment that Next already decoded to contain a slash", () => {
    expect(safeSegments(["attendance", "me/../../leave-attachments", "x.pdf"])).toBeNull();
  });

  it("rejects double-encoded traversal and backslashes", () => {
    expect(safeSegments(["psikotes", "..%2F..%2Fcontracts", "a.pdf"])).toBeNull();
    expect(safeSegments(["psikotes", "%2e%2e", "a.pdf"])).toBeNull();
    expect(safeSegments(["psikotes", "a\\..\\b"])).toBeNull();
    expect(safeSegments(["psikotes", "a%00b"])).toBeNull();
  });

  it("rejects malformed percent-encoding", () => {
    expect(safeSegments(["psikotes", "%E0%A4%A"])).toBeNull();
  });
});

describe("isWithinPrefix", () => {
  it("accepts the prefix itself and its children", () => {
    expect(isWithinPrefix("/srv/private/psikotes", "/srv/private/psikotes")).toBe(true);
    expect(isWithinPrefix("/srv/private/psikotes/a/b.png", "/srv/private/psikotes")).toBe(true);
  });

  it("rejects siblings sharing a name prefix and resolved traversal", () => {
    expect(isWithinPrefix("/srv/private/psikotes-old/a.png", "/srv/private/psikotes")).toBe(false);
    expect(isWithinPrefix(path.join("/srv/private/psikotes", "..", "contracts"), "/srv/private/psikotes")).toBe(false);
  });
});

describe("safeSegmentsUnder", () => {
  it("locks the first segment to the folder and enforces depth", () => {
    expect(safeSegmentsUnder(["announcements", "a.png"], "announcements")).toEqual(["announcements", "a.png"]);
    expect(safeSegmentsUnder(["contracts", "a.pdf"], "announcements")).toBeNull();
    expect(safeSegmentsUnder(["attendance", "a.jpg"], "attendance", 3)).toBeNull();
    expect(safeSegmentsUnder(["announcements", "..%2Fcontracts", "a.pdf"], "announcements")).toBeNull();
  });
});
