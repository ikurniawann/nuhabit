import { describe, expect, it } from "vitest";
import {
  analyzeRace,
  canTargetRace,
  daysUntil,
  planMemberRaceUpdate,
  predictRaceSec,
  raceReadinessScore,
} from "./races";

const now = new Date("2026-10-03T10:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("predictRaceSec", () => {
  it("is null until a full simulation exists", () => {
    expect(predictRaceSec([])).toBeNull();
    expect(predictRaceSec([0, -5, Number.NaN])).toBeNull();
  });
  it("takes the best simulation and applies the race-day factor", () => {
    expect(predictRaceSec([6000, 5400, 5800])).toBe(Math.round(5400 * 0.97));
  });
});

describe("raceReadinessScore", () => {
  it("counts activities in the last 28 days against a 12-session plan", () => {
    const six = Array.from({ length: 6 }, (_, i) => daysAgo(i * 3));
    expect(raceReadinessScore(six, now)).toBe(50);
  });
  it("ignores activities older than 28 days or in the future", () => {
    expect(raceReadinessScore([daysAgo(29), daysAgo(-1), daysAgo(27.9)], now)).toBe(8);
  });
  it("caps at 100 and floors at 0", () => {
    expect(raceReadinessScore(Array.from({ length: 20 }, () => daysAgo(1)), now)).toBe(100);
    expect(raceReadinessScore([], now)).toBe(0);
  });
});

describe("analyzeRace", () => {
  it("compares a result with goal and prediction", () => {
    expect(analyzeRace(5612, 5700, 5500)).toEqual({ vsGoalSec: -88, vsPredictionSec: 112, achievedGoal: true });
  });
  it("leaves comparisons null when there is nothing to compare with", () => {
    expect(analyzeRace(5612, null, null)).toEqual({ vsGoalSec: null, vsPredictionSec: null, achievedGoal: null });
  });
  it("treats an exact goal as achieved", () => {
    expect(analyzeRace(5700, 5700, null).achievedGoal).toBe(true);
    expect(analyzeRace(5701, 5700, null).achievedGoal).toBe(false);
  });
});

describe("planMemberRaceUpdate", () => {
  it("moves to raced when a result is logged", () => {
    expect(planMemberRaceUpdate("training", { resultSec: 5612.4 })).toEqual({
      ok: true,
      status: "raced",
      resultSec: 5612,
    });
  });
  it("updates goal and division while training", () => {
    expect(planMemberRaceUpdate("training", { goalSec: 5400, division: "MEN_PRO" })).toEqual({
      ok: true,
      status: "training",
      goalSec: 5400,
      division: "MEN_PRO",
    });
    expect(planMemberRaceUpdate("training", { goalSec: null })).toEqual({ ok: true, status: "training", goalSec: null });
  });
  it("cancels", () => {
    expect(planMemberRaceUpdate("training", { cancel: true })).toEqual({ ok: true, status: "cancelled" });
  });
  it("rejects bad numbers and contradictory requests", () => {
    expect(planMemberRaceUpdate("training", { goalSec: 0 }).ok).toBe(false);
    expect(planMemberRaceUpdate("training", { resultSec: -1 }).ok).toBe(false);
    expect(planMemberRaceUpdate("training", { cancel: true, resultSec: 10 }).ok).toBe(false);
  });
  it("freezes raced and cancelled entries", () => {
    expect(planMemberRaceUpdate("raced", { resultSec: 5000 })).toEqual({ ok: false, error: "Hasil race ini sudah dicatat." });
    expect(planMemberRaceUpdate("cancelled", { goalSec: 5000 })).toEqual({ ok: false, error: "Race ini sudah dibatalkan." });
  });
});

describe("race helpers", () => {
  it("only lets members target races that are still ahead", () => {
    expect(canTargetRace("registration_open")).toBe(true);
    expect(canTargetRace("sold_out")).toBe(true);
    expect(canTargetRace("completed")).toBe(false);
    expect(canTargetRace("cancelled")).toBe(false);
  });
  it("counts whole days until the race", () => {
    expect(daysUntil(new Date(now.getTime() + 1.2 * 86_400_000), now)).toBe(2);
    expect(daysUntil(daysAgo(3), now)).toBe(0);
  });
});
