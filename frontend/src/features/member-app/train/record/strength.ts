export const EXERCISE_LIBRARY: Record<string, string[]> = {
  Back: ["Lat Pulldown", "Barbell Row", "Seated Cable Row", "Pull-up"],
  Chest: ["Bench Press", "Incline DB Press", "Cable Fly", "Push-up"],
  Legs: ["Back Squat", "Leg Press", "Romanian Deadlift", "Walking Lunge"],
  Shoulders: ["Overhead Press", "Lateral Raise", "Rear Delt Fly"],
  Arms: ["Bicep Curl", "Hammer Curl", "Tricep Pushdown", "Skullcrusher"],
  Core: ["Plank", "Hanging Knee Raise", "Cable Crunch"],
  Glutes: ["Hip Thrust", "Glute Bridge", "Cable Kickback"],
  "Full body": ["Deadlift", "Clean & Press", "Kettlebell Swing", "Burpee"],
};

export interface StrengthSet {
  kg: string;
  reps: string;
  done: boolean;
}
export interface StrengthExercise {
  name: string;
  muscle: string;
  sets: StrengthSet[];
}
export const emptySets = (): StrengthSet[] =>
  Array.from({ length: 3 }, () => ({ kg: "", reps: "", done: false }));
