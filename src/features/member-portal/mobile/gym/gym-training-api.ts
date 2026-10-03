"use client";

import { useQuery } from "@tanstack/react-query";
import type { Division, WorkoutBlock, WorkoutBlockResult, WorkoutType } from "@/lib/gym/hyrox";
import type { MemberRaceOverview } from "@/lib/gym/races-server";
import type { WorkoutHistoryItem, WorkoutSessionView, WorkoutView } from "@/lib/gym/training-server";
import { memberApi, postJson } from "../mobile-api";

export type { MemberRaceOverview, WorkoutHistoryItem, WorkoutSessionView, WorkoutView };

export const GYM_KEYS = {
  workouts: ["member-portal", "gym", "workouts"],
  races: ["member-portal", "gym", "races"],
} as const;

export interface WorkoutOptions {
  stations: { id: string; name: string; order: number; equipment: string[] }[];
  exercises: { id: string; name: string; equipment: string[] }[];
  equipment: string[];
  workouts: WorkoutHistoryItem[];
}

export const useWorkoutOptions = () =>
  useQuery({ queryKey: GYM_KEYS.workouts, queryFn: () => memberApi<WorkoutOptions>("/api/member-portal/gym/workouts") });

export const useRaceOverview = () =>
  useQuery({ queryKey: GYM_KEYS.races, queryFn: () => memberApi<MemberRaceOverview>("/api/member-portal/gym/races") });

export const gymApi = {
  generate: (input: {
    type: WorkoutType;
    division: Division;
    station_orders: number[];
    available_equipment: string[] | null;
  }) =>
    postJson<{ workout: WorkoutView; unresolved_exercise_ids: string[] }>("/api/member-portal/gym/workouts", input),
  start: (workoutId: string) => postJson<WorkoutSessionView>(`/api/member-portal/gym/workouts/${workoutId}/start`, {}),
  session: (
    sessionId: string,
    body:
      | { action: "pause" | "resume" }
      | { action: "record"; order: number; duration_sec: number }
      | { action: "complete"; block_results: { order: number; duration_sec: number }[]; partial: boolean }
  ) => postJson<WorkoutSessionView>(`/api/member-portal/gym/workouts/sessions/${sessionId}`, body),
  register: (input: { race_event_id: string; division: Division; goal_sec: number | null }) =>
    postJson<{ id: string }>("/api/member-portal/gym/races", input),
  updateRace: (entryId: string, body: { division?: Division; goal_sec?: number | null; result_sec?: number; cancel?: boolean }) =>
    postJson<{ id: string }>(`/api/member-portal/gym/races/${entryId}`, body, "PATCH"),
};

export const toApiResults = (results: readonly WorkoutBlockResult[]) =>
  results.map((r) => ({ order: r.order, duration_sec: r.durationSec }));

const EQUIPMENT_LABELS: Record<string, string> = {
  skierg: "SkiErg",
  sled: "Sled",
  rower: "Rower",
  kettlebell: "Kettlebell",
  sandbag: "Sandbag",
  wall_ball: "Wall ball",
  air_bike: "Air bike",
};

export const equipmentLabel = (code: string) => EQUIPMENT_LABELS[code] ?? code.replace(/_/g, " ");

/** "1000 m", "100 rep", atau keduanya. */
export const blockVolume = (block: Pick<WorkoutBlock, "distanceM" | "reps">) =>
  [block.distanceM ? `${block.distanceM} m` : null, block.reps ? `${block.reps} rep` : null].filter(Boolean).join(" · ");
