import { describe, expect, it } from "vitest";
import {
  equipmentCatalog,
  finishSession,
  formatDuration,
  generateWorkout,
  parseDuration,
  listSubstitutes,
  newSession,
  pauseSession,
  recordBlock,
  resumeSession,
  sessionActiveSec,
  sessionCompletionPct,
  unavailableExerciseIds,
  type Exercise,
  type GenerateWorkoutArgs,
  type SubstitutionRule,
  type WorkoutSessionState,
} from "./hyrox";

const ex = (
  id: string,
  category: Exercise["category"],
  station: number | null,
  equipment: string[],
  spec: Exercise["defaultSpec"]
): Exercise => ({
  id,
  name: id,
  category,
  equipment,
  hyroxStationOrder: station,
  difficulty: 2,
  defaultSpec: spec,
  videoUrl: null,
});

const EXERCISES: Exercise[] = [
  ex("ski", "ERG", 1, ["skierg"], { distanceM: 1000, reps: null }),
  ex("push", "SLED", 2, ["sled"], { distanceM: 50, reps: null }),
  ex("pull", "SLED", 3, ["sled"], { distanceM: 50, reps: null }),
  ex("burpee", "JUMP", 4, [], { distanceM: 80, reps: null }),
  ex("row", "ERG", 5, ["rower"], { distanceM: 1000, reps: null }),
  ex("carry", "CARRY", 6, ["kettlebell"], { distanceM: 200, reps: null }),
  ex("lunge", "LUNGE", 7, ["sandbag"], { distanceM: 100, reps: null }),
  ex("wallball", "THROW", 8, ["wall_ball"], { distanceM: null, reps: 100 }),
  ex("run", "RUN", null, [], { distanceM: 1000, reps: null }),
  ex("bike", "CONDITIONING", null, ["air_bike"], { distanceM: null, reps: null }),
];

const rule = (from: string, to: string, similarity: number, volumeFactor = 1): SubstitutionRule => ({
  originalExerciseId: from,
  alternativeExerciseId: to,
  similarity,
  volumeFactor,
  conversionNote: "",
});

const SUBS: SubstitutionRule[] = [
  rule("ski", "row", 0.85),
  rule("ski", "bike", 0.65, 0.5),
  rule("row", "ski", 0.85),
  rule("row", "bike", 0.7, 0.5),
  rule("push", "pull", 0.75),
  rule("push", "lunge", 0.55, 2),
  rule("wallball", "burpee", 0.6, 0.67),
  rule("run", "bike", 0.5, 3),
];

const args = (over: Partial<GenerateWorkoutArgs> = {}): GenerateWorkoutArgs => ({
  type: "FULL_SIMULATION",
  division: "MEN_OPEN",
  stationOrders: [],
  excludedExerciseIds: [],
  availableEquipment: null,
  exercises: EXERCISES,
  substitutions: SUBS,
  pick: () => 0,
  ...over,
});

describe("listSubstitutes", () => {
  it("orders substitutes by similarity, best first", () => {
    expect(listSubstitutes("ski", SUBS, EXERCISES).map((s) => s.exercise.id)).toEqual(["row", "bike"]);
  });
  it("drops rules that point at an unknown exercise", () => {
    expect(listSubstitutes("ski", [rule("ski", "ghost", 0.9)], EXERCISES)).toEqual([]);
  });
});

describe("unavailableExerciseIds", () => {
  it("treats null as every piece of equipment available", () => {
    expect(unavailableExerciseIds(EXERCISES, null)).toEqual([]);
  });
  it("marks exercises whose equipment is missing; bodyweight always works", () => {
    const missing = unavailableExerciseIds(EXERCISES, ["rower", "kettlebell"]);
    expect(missing).toContain("ski");
    expect(missing).toContain("push");
    expect(missing).not.toContain("row");
    expect(missing).not.toContain("burpee");
    expect(missing).not.toContain("run");
  });
  it("lists the equipment catalogue once, sorted", () => {
    expect(equipmentCatalog(EXERCISES)).toEqual([
      "air_bike", "kettlebell", "rower", "sandbag", "skierg", "sled", "wall_ball",
    ]);
  });
});

describe("generateWorkout: FULL_SIMULATION", () => {
  const result = generateWorkout(args());

  it("alternates 1 km runs with all eight stations in race order", () => {
    expect(result.blocks).toHaveLength(16);
    expect(result.blocks.filter((b) => b.kind === "RUN").every((b) => b.distanceM === 1000)).toBe(true);
    expect(result.blocks.filter((b) => b.kind === "STATION").map((b) => b.exerciseId)).toEqual([
      "ski", "push", "pull", "burpee", "row", "carry", "lunge", "wallball",
    ]);
    expect(result.blocks.map((b) => b.order)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("sums the block targets into the total", () => {
    // Men Open: 8 × 330 s lari + 1830 s stasiun.
    expect(result.totalTargetSec).toBe(8 * 330 + 1830);
    expect(result.totalTargetSec).toBe(result.blocks.reduce((s, b) => s + b.targetSec, 0));
  });

  it("applies division loads and rep counts", () => {
    const station = (division: GenerateWorkoutArgs["division"], id: string) =>
      generateWorkout(args({ division })).blocks.find((b) => b.exerciseId === id)!;
    expect(station("MEN_OPEN", "push").weightNote).toBe("Sled 152 kg");
    expect(station("MEN_PRO", "push").weightNote).toBe("Sled 202 kg");
    expect(station("WOMEN_OPEN", "carry").weightNote).toBe("2×16 kg");
    expect(station("WOMEN_PRO", "wallball").weightNote).toBe("Bola 6 kg");
    expect(station("WOMEN_OPEN", "wallball").reps).toBe(75);
    expect(station("WOMEN_PRO", "wallball").reps).toBe(100);
    expect(station("MEN_OPEN", "ski").weightNote).toBeNull();
  });

  it("scales targets per division", () => {
    const ski = (division: GenerateWorkoutArgs["division"]) =>
      generateWorkout(args({ division })).blocks.find((b) => b.exerciseId === "ski")!.targetSec;
    expect(ski("MEN_OPEN")).toBe(240);
    expect(ski("MEN_PRO")).toBe(216);
    expect(ski("WOMEN_OPEN")).toBe(252);
    expect(ski("WOMEN_PRO")).toBe(228);
    const run = generateWorkout(args({ division: "WOMEN_OPEN" })).blocks[0]!;
    expect(run.targetSec).toBe(360);
  });
});

describe("generateWorkout: shorter formats", () => {
  it("COVERAGE picks four stations with 600 m runs, sorted in race order", () => {
    const picks = [7, 0, 3, 1];
    const result = generateWorkout(args({ type: "COVERAGE", pick: () => picks.shift() ?? 0 }));
    expect(result.blocks).toHaveLength(8);
    expect(result.blocks.filter((b) => b.kind === "RUN").every((b) => b.distanceM === 600)).toBe(true);
    const orders = result.blocks.filter((b) => b.kind === "STATION").map((b) => b.exerciseId);
    expect(orders).toEqual(["ski", "pull", "row", "wallball"]);
  });

  it("COVERAGE honours an explicit station choice", () => {
    const result = generateWorkout(args({ type: "COVERAGE", stationOrders: [8, 2] }));
    expect(result.blocks.filter((b) => b.kind === "STATION").map((b) => b.exerciseId)).toEqual(["push", "wallball"]);
  });

  it("QUICK halves the station volume and target, with 400 m runs", () => {
    const result = generateWorkout(args({ type: "QUICK", stationOrders: [1, 8] }));
    const [run, ski, , wallball] = result.blocks;
    expect(run!.distanceM).toBe(400);
    expect(ski!.distanceM).toBe(500);
    expect(ski!.targetSec).toBe(120);
    expect(wallball!.reps).toBe(50);
  });

  it("PRACTICE repeats one station for three rounds of 200 m", () => {
    const result = generateWorkout(args({ type: "PRACTICE", stationOrders: [4] }));
    expect(result.blocks).toHaveLength(6);
    expect(result.blocks.filter((b) => b.kind === "STATION").every((b) => b.exerciseId === "burpee")).toBe(true);
    expect(result.blocks.filter((b) => b.kind === "RUN").every((b) => b.distanceM === 200)).toBe(true);
  });

  it("clamps an out-of-range pick instead of crashing", () => {
    const result = generateWorkout(args({ type: "QUICK", pick: () => 99 }));
    expect(result.blocks.filter((b) => b.kind === "STATION")).toHaveLength(4);
  });

  it("returns no blocks when the library has no stations", () => {
    const result = generateWorkout(args({ exercises: EXERCISES.filter((e) => e.hyroxStationOrder === null) }));
    expect(result.blocks).toEqual([]);
    expect(result.totalTargetSec).toBe(0);
  });
});

describe("generateWorkout: substitutions", () => {
  it("swaps an excluded station for its closest allowed substitute", () => {
    const result = generateWorkout(args({ excludedExerciseIds: ["ski"] }));
    const block = result.blocks.find((b) => b.originalExerciseId === "ski")!;
    expect(block.exerciseId).toBe("row");
    expect(block.similarity).toBe(0.85);
    expect(block.distanceM).toBe(1000);
  });

  it("follows equipment availability and converts volume", () => {
    // Tanpa skierg dan rower: ski dan row jatuh ke air bike dengan separuh jarak.
    const result = generateWorkout(
      args({ availableEquipment: ["sled", "kettlebell", "sandbag", "wall_ball", "air_bike"] })
    );
    const ski = result.blocks.find((b) => b.originalExerciseId === "ski")!;
    expect(ski.exerciseId).toBe("bike");
    expect(ski.distanceM).toBe(500);
    expect(result.excludedExerciseIds).toEqual(expect.arrayContaining(["ski", "row"]));
  });

  it("drops the race load note when a substitute stands in", () => {
    const result = generateWorkout(args({ availableEquipment: ["rower", "kettlebell", "sandbag", "wall_ball"] }));
    const push = result.blocks.find((b) => b.originalExerciseId === "push")!;
    expect(push.exerciseId).toBe("lunge");
    expect(push.distanceM).toBe(100);
    expect(push.weightNote).toBeNull();
  });

  it("keeps a station it cannot replace and reports it", () => {
    const result = generateWorkout(args({ availableEquipment: [] }));
    expect(result.unresolvedExerciseIds).toEqual(expect.arrayContaining(["carry", "lunge"]));
    expect(result.blocks.find((b) => b.exerciseId === "carry")!.originalExerciseId).toBeNull();
    // Wall ball tanpa bola → burpee, 2/3 repetisi.
    const wallball = result.blocks.find((b) => b.originalExerciseId === "wallball")!;
    expect(wallball.exerciseId).toBe("burpee");
    expect(wallball.reps).toBe(67);
  });

  it("substitutes the run itself when the member excludes running", () => {
    const result = generateWorkout(args({ type: "QUICK", stationOrders: [5], excludedExerciseIds: ["run"] }));
    expect(result.blocks[0]).toMatchObject({ kind: "RUN", exerciseId: "bike", distanceM: 1200, similarity: 0.5 });
  });
});

describe("workout session lifecycle", () => {
  const t0 = new Date("2026-10-03T06:00:00Z");
  const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
  const unwrap = (r: ReturnType<typeof pauseSession>): WorkoutSessionState => {
    if (!r.ok) throw new Error(r.error.code);
    return r.session;
  };

  it("starts on block 1", () => {
    expect(newSession(t0)).toMatchObject({ status: "started", currentBlock: 1, startedAt: t0.toISOString() });
  });

  it("tracks pause count and total pause time", () => {
    let s = newSession(t0);
    s = unwrap(pauseSession(s, at(60)));
    expect(s).toMatchObject({ status: "paused", pauseCount: 1 });
    s = unwrap(resumeSession(s, at(90)));
    s = unwrap(pauseSession(s, at(120)));
    s = unwrap(resumeSession(s, at(130)));
    expect(s).toMatchObject({ status: "started", pauseCount: 2, totalPauseSec: 40, pausedAt: null });
  });

  it("rejects illegal transitions", () => {
    const s = newSession(t0);
    expect(resumeSession(s, t0)).toEqual({
      ok: false,
      error: { code: "invalid_transition", from: "started", to: "started" },
    });
    const paused = unwrap(pauseSession(s, t0));
    expect(pauseSession(paused, t0).ok).toBe(false);
  });

  it("overwrites a repeated block result and advances the cursor", () => {
    let s = newSession(t0);
    s = unwrap(recordBlock(s, 4, { order: 1, durationSec: 300 }));
    s = unwrap(recordBlock(s, 4, { order: 1, durationSec: 280.4 }));
    expect(s.blockResults).toEqual([{ order: 1, durationSec: 280 }]);
    expect(s.currentBlock).toBe(2);
    expect(recordBlock(s, 4, { order: 5, durationSec: 10 })).toMatchObject({ ok: false, error: { code: "invalid_block" } });
    expect(recordBlock(s, 4, { order: 2, durationSec: -1 })).toMatchObject({ ok: false, error: { code: "invalid_duration" } });
  });

  it("completes only when every block has a result", () => {
    const s = newSession(t0);
    const done = unwrap(
      finishSession(s, 2, { blockResults: [{ order: 1, durationSec: 100 }, { order: 2, durationSec: 200 }] }, at(400))
    );
    expect(done).toMatchObject({ status: "completed", endedAt: at(400).toISOString() });
    expect(sessionActiveSec(done)).toBe(300);
    expect(sessionCompletionPct(done, 2)).toBe(100);

    const half = unwrap(finishSession(s, 2, { blockResults: [{ order: 1, durationSec: 100 }] }, at(400)));
    expect(half.status).toBe("partial");
    expect(sessionCompletionPct(half, 2)).toBe(50);
  });

  it("finishes as partial on request and closes an open pause", () => {
    const paused = unwrap(pauseSession(newSession(t0), at(100)));
    const stopped = unwrap(finishSession(paused, 4, { partial: true }, at(160)));
    expect(stopped).toMatchObject({ status: "partial", totalPauseSec: 60, pausedAt: null });
    expect(finishSession(stopped, 4, {}, at(200))).toEqual({ ok: false, error: { code: "finished" } });
    expect(recordBlock(stopped, 4, { order: 1, durationSec: 1 })).toEqual({ ok: false, error: { code: "finished" } });
  });

  it("guards completion percentage against empty workouts", () => {
    expect(sessionCompletionPct({ blockResults: [] }, 0)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(245)).toBe("4:05");
    expect(formatDuration(3909)).toBe("1:05:09");
    expect(formatDuration(-3)).toBe("0:00");
  });
});

describe("parseDuration", () => {
  it("reads h:mm:ss, mm:ss, and bare minutes", () => {
    expect(parseDuration("1:30:00")).toBe(5400);
    expect(parseDuration(" 85:30 ")).toBe(5130);
    expect(parseDuration("90")).toBe(5400);
  });
  it("rejects junk and zero", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0:00")).toBeNull();
  });
});
