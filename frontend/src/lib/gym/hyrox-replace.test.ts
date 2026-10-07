import { describe, expect, it } from "vitest";
import { replaceBlockExercise, type Exercise, type SubstitutionRule, type WorkoutBlock } from "./hyrox";

const sledPush: WorkoutBlock = {
  order: 4,
  kind: "STATION",
  exerciseId: "sled",
  exerciseName: "Sled Push",
  originalExerciseId: null,
  originalExerciseName: null,
  similarity: null,
  distanceM: 50,
  reps: null,
  weightNote: "Sled 152 kg",
  targetSec: 180,
  videoUrl: "https://youtu.be/sled",
};

const exercise = (id: string, name: string): Exercise => ({
  id,
  name,
  category: "CONDITIONING",
  equipment: [],
  hyroxStationOrder: null,
  difficulty: 2,
  defaultSpec: { distanceM: null, reps: null },
  videoUrl: `https://youtu.be/${id}`,
});

const rule = (alt: string, similarity: number): SubstitutionRule => ({
  originalExerciseId: "sled",
  alternativeExerciseId: alt,
  similarity,
  volumeFactor: 1,
  conversionNote: "",
});

describe("replaceBlockExercise", () => {
  it("swaps the exercise, remembers the station and drops the race load", () => {
    const next = replaceBlockExercise(sledPush, exercise("bike", "Air Bike"), rule("bike", 0.6));
    expect(next).toMatchObject({
      exerciseId: "bike",
      exerciseName: "Air Bike",
      originalExerciseId: "sled",
      originalExerciseName: "Sled Push",
      similarity: 0.6,
      weightNote: null,
      videoUrl: "https://youtu.be/bike",
      distanceM: 50,
      targetSec: 180,
    });
  });

  it("keeps the first original when swapped twice", () => {
    const once = replaceBlockExercise(sledPush, exercise("bike", "Air Bike"), rule("bike", 0.6));
    const twice = replaceBlockExercise(once, exercise("prowler", "Prowler"), rule("prowler", 0.9));
    expect(twice).toMatchObject({ exerciseId: "prowler", originalExerciseId: "sled", originalExerciseName: "Sled Push", similarity: 0.9 });
  });
});
