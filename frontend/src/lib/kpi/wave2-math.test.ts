import { describe, expect, it } from "vitest";
import {
  computeTeamOntime,
  scheduledMinutesForShift,
} from "@/lib/kpi/wave2-math";

describe("computeTeamOntime", () => {
  const employees = [
    { id: "a", department_id: "d1" },
    { id: "b", department_id: "d1" },
    { id: "c", department_id: "d2" },
    { id: "x", department_id: null },
  ];

  it("averages members' ontime per department", () => {
    const ontime = new Map([
      ["a", 1],
      ["b", 0.5],
      ["c", 0.8],
    ]);
    const result = computeTeamOntime(employees, ontime);
    expect(result.get("d1")!.actual).toBeCloseTo(0.75);
    expect(result.get("d1")!.sampleSize).toBe(2);
    expect(result.get("d2")!.actual).toBeCloseTo(0.8);
  });

  it("members without data are excluded from the average", () => {
    const ontime = new Map([["a", 0.9]]); // b tanpa data
    const result = computeTeamOntime(employees, ontime);
    expect(result.get("d1")!.actual).toBeCloseTo(0.9);
    expect(result.get("d1")!.sampleSize).toBe(1);
  });

  it("department with no data at all is absent", () => {
    const result = computeTeamOntime(employees, new Map());
    expect(result.size).toBe(0);
  });
});

describe("scheduledMinutesForShift", () => {
  it("regular shift: end - start - break", () => {
    expect(
      scheduledMinutesForShift({
        start_time: "08:00:00",
        end_time: "17:00:00",
        break_minutes: 60,
        is_overnight: false,
      })
    ).toBe(480); // 9 jam - 1 jam istirahat
  });

  it("overnight shift crosses midnight", () => {
    expect(
      scheduledMinutesForShift({
        start_time: "22:00:00",
        end_time: "06:00:00",
        break_minutes: 30,
        is_overnight: true,
      })
    ).toBe(450); // 8 jam - 30 mnt
  });

  it("never negative", () => {
    expect(
      scheduledMinutesForShift({
        start_time: "08:00:00",
        end_time: "08:00:00",
        break_minutes: 60,
        is_overnight: false,
      })
    ).toBe(0);
  });
});
