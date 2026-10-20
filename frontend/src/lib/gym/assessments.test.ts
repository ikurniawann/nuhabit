import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatMetric,
  formatSeconds,
  metricInput,
  metricProgress,
  metricSeries,
  METRICS,
  parseMetricInput,
  type Assessment,
} from "./assessments";

const metric = (key: string) => METRICS.find((m) => m.key === key)!;

const row = (date: string, values: Partial<Assessment>): Assessment =>
  ({
    id: date,
    customer_id: "c",
    member_name: null,
    coach_id: null,
    coach_name: null,
    assessed_on: date,
    weight_kg: null,
    body_fat_pct: null,
    muscle_mass_kg: null,
    resting_hr: null,
    run_1km_sec: null,
    ski_1km_sec: null,
    row_1km_sec: null,
    wall_balls_max_reps: null,
    sled_push_sec: null,
    sled_pull_sec: null,
    burpee_broad_jump_sec: null,
    notes: "",
    goals: "",
    created_by_name: "",
    created_at: date,
    ...values,
  }) as Assessment;

describe("assessment metrics", () => {
  it("formats values per kind", () => {
    expect(formatSeconds(245)).toBe("4:05");
    expect(formatMetric(metric("run_1km_sec"), 245)).toBe("4:05");
    expect(formatMetric(metric("weight_kg"), 72.5)).toBe("72,5 kg");
    expect(formatMetric(metric("wall_balls_max_reps"), 60)).toBe("60 reps");
    expect(formatMetric(metric("weight_kg"), null)).toBe("-");
  });

  it("parses form input", () => {
    expect(parseMetricInput("seconds", "4:05")).toBe(245);
    expect(parseMetricInput("seconds", "245")).toBe(245);
    expect(parseMetricInput("seconds", "4:75")).toBeUndefined();
    expect(parseMetricInput("decimal", "72,5")).toBe(72.5);
    expect(parseMetricInput("count", "60.5")).toBeUndefined();
    expect(parseMetricInput("decimal", " ")).toBeNull();
    expect(metricInput(metric("weight_kg"), 72.5)).toBe("72,5");
    expect(metricInput(metric("sled_push_sec"), 95)).toBe("1:35");
  });

  it("builds a dated series and the change since the first measurement", () => {
    const history = [
      row("2031-03-03", { run_1km_sec: 238, weight_kg: 71 }),
      row("2031-02-01", { run_1km_sec: 250 }),
      row("2031-01-01", { weight_kg: 73 }),
    ];
    const run = metricSeries(history, "run_1km_sec");
    expect(run).toEqual([
      { date: "2031-02-01", value: 250 },
      { date: "2031-03-03", value: 238 },
    ]);
    expect(metricProgress(metric("run_1km_sec"), run)).toEqual({ latest: 238, change: -12, improved: true });
    expect(metricProgress(metric("weight_kg"), metricSeries(history, "weight_kg"))).toEqual({
      latest: 71,
      change: -2,
      improved: false,
    });
    expect(metricProgress(metric("resting_hr"), [])).toBeNull();
    expect(metricProgress(metric("resting_hr"), [{ date: "x", value: 60 }])).toEqual({ latest: 60, change: null, improved: null });
    expect(formatChange(metric("run_1km_sec"), -12)).toBe("-0:12");
    expect(formatChange(metric("weight_kg"), 1.5)).toBe("+1,5 kg");
  });
});
