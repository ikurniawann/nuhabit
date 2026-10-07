import { describe, it, expect } from "vitest";
import { activeWeightTotal, buildConfigDraft, configPayloadItems } from "./ui-config";

const mappings = [
  { department_id: "bar", indicator_id: "absen", weight: "40.00" },
  { department_id: "hr", indicator_id: "absen", weight: 10 },
];

describe("buildConfigDraft", () => {
  it("uses saved mappings, then defaults, with local edits on top", () => {
    const draft = buildConfigDraft(["absen", "sales"], mappings, "bar", {
      sales: { enabled: true, weight: "60" },
    });
    expect(draft).toEqual({
      absen: { enabled: true, weight: "40" },
      sales: { enabled: true, weight: "60" },
    });
    expect(buildConfigDraft(["sales"], mappings, "bar", undefined)).toEqual({
      sales: { enabled: false, weight: "10" },
    });
  });
});

describe("activeWeightTotal / configPayloadItems", () => {
  it("sums enabled weights and builds the payload", () => {
    const draft = {
      absen: { enabled: true, weight: "40" },
      sales: { enabled: false, weight: "60" },
      rubric: { enabled: true, weight: "x" },
    };
    expect(activeWeightTotal(draft)).toBe(40);
    expect(configPayloadItems(["absen", "rubric", "missing"], draft)).toEqual([
      { indicator_id: "absen", enabled: true, weight: 40 },
      { indicator_id: "rubric", enabled: true, weight: 0 },
      { indicator_id: "missing", enabled: false, weight: 0 },
    ]);
  });
});
