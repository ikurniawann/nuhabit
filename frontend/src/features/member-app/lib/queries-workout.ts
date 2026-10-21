"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Division,
  Exercise,
  SubstitutionRule,
  WorkoutHistoryItem,
  WorkoutSessionView as SessionRow,
  WorkoutType,
  WorkoutView,
} from "@/lib/gym/hyrox";
import {
  leaderboardParams,
  type AgeGroup,
  type HyroxResult,
  type LeaderboardQuery,
  type LeaderboardView,
  type ResultDivision,
  type ResultSource,
  type SplitCompare,
  type SplitList,
} from "@/lib/gym/hyrox-results";
import type { MemberRaceEntry, MemberRaceView, RaceEventListRow } from "@/lib/gym/races";
import {
  flattenWorkoutHistory,
  toMyRace,
  toRaceEvent,
  toSessionView,
  toWorkout,
  type GeneratedWorkout,
  type MyRaceView,
  type RaceEventView,
  type UserRace,
  type WorkoutSessionView,
} from "@/lib/member-app/workout";
import { memberApi } from "./api";
import { asset } from "./links";

/**
 * Data workout, race, dan pustaka latihan aplikasi member. Bentuk dipetakan
 * ke kontrak referensi (`api.workout.*`, `api.races.*`) di sini.
 */

const toRaceView = (row: RaceEventListRow): RaceEventView => ({
  event: toRaceEvent(row, asset),
  joined: row.my_entry_id !== null,
  participantCount: row.entrant_count,
});

/** Sesi + workout-nya dalam bentuk `WorkoutSessionView` referensi. */
async function sessionView(session: SessionRow): Promise<WorkoutSessionView> {
  const workout = await memberApi<WorkoutView>(`/app/workout/workouts/${session.workout_id}`);
  return toSessionView(session, toWorkout(workout));
}

const sessionAction = async (sessionId: string, json: Record<string, unknown>) =>
  sessionView(await memberApi<SessionRow>(`/gym/workouts/sessions/${sessionId}`, { method: "POST", json }));

export const api = {
  workout: {
    exercises: () => memberApi<{ exercises: Exercise[]; substitutions: SubstitutionRule[] }>("/app/workout/exercises"),
    generate: async (input: { type: WorkoutType; division: Division; stationOrders: number[]; excludedExerciseIds: string[] }) =>
      toWorkout(
        (
          await memberApi<{ workout: WorkoutView }>("/gym/workouts", {
            method: "POST",
            json: {
              type: input.type,
              division: input.division,
              station_orders: input.stationOrders,
              excluded_exercise_ids: input.excludedExerciseIds,
            },
          })
        ).workout
      ),
    get: async (id: string): Promise<GeneratedWorkout> => toWorkout(await memberApi<WorkoutView>(`/app/workout/workouts/${id}`)),
    replaceBlock: async (id: string, order: number, exerciseId: string) =>
      toWorkout(await memberApi<WorkoutView>(`/app/workout/workouts/${id}`, { method: "PATCH", json: { order, exercise_id: exerciseId } })),
    start: async (id: string) => sessionView(await memberApi<SessionRow>(`/gym/workouts/${id}/start`, { method: "POST", json: {} })),
    sessions: async () => flattenWorkoutHistory((await memberApi<{ workouts: WorkoutHistoryItem[] }>("/gym/workouts")).workouts),
    session: async (id: string) => sessionView(await memberApi<SessionRow>(`/gym/workouts/sessions/${id}`)),
    completeBlock: (sessionId: string, order: number, durationSec: number) =>
      sessionAction(sessionId, { action: "record", order, duration_sec: durationSec }),
    pause: (sessionId: string) => sessionAction(sessionId, { action: "pause" }),
    resume: (sessionId: string) => sessionAction(sessionId, { action: "resume" }),
    finish: (sessionId: string, partial: boolean) => sessionAction(sessionId, { action: "complete", partial }),
  },
  races: {
    list: async (query?: { region?: string; scope?: "upcoming" | "results" }) => {
      const params = new URLSearchParams({ scope: query?.scope ?? "upcoming" });
      if (query?.region) params.set("region", query.region);
      return (await memberApi<RaceEventListRow[]>(`/app/workout/races?${params}`)).map(toRaceView);
    },
    get: async (id: string) => {
      const data = await memberApi<{ event: RaceEventListRow; my_race: MemberRaceEntry | null }>(`/app/workout/races/${id}`);
      const entry = data.my_race;
      const myRace: { userRace: Pick<UserRace, "division" | "goalSec" | "resultId"> } | null = entry
        ? { userRace: { division: entry.division, goalSec: entry.goal_sec, resultId: entry.result_id ?? null } }
        : null;
      // Dihitung saat data diambil (bukan saat render) seperti `daysToRace` referensi.
      const daysToRace = Math.ceil((new Date(data.event.starts_at).getTime() - Date.now()) / 86_400_000);
      return { view: toRaceView(data.event), myRace, daysToRace };
    },
    mine: async (): Promise<MyRaceView[]> => {
      const data = await memberApi<{ my_races: MemberRaceView[]; readiness: number; simulation_count: number }>(
        "/app/workout/races/mine"
      );
      const stats = { readiness: data.readiness, simulationCount: data.simulation_count };
      return data.my_races.map((row) => toMyRace(row, stats, asset));
    },
    register: (raceEventId: string, input: { division: Division; goalSec: number | null }) =>
      memberApi<{ id: string }>("/gym/races", {
        method: "POST",
        json: { race_event_id: raceEventId, division: input.division, goal_sec: input.goalSec },
      }),
  },
};

/** What a member enters for a HYROX result; seconds, null when left empty. */
export interface ResultFields {
  division: ResultDivision;
  age_group: AgeGroup | null;
  run_sec: SplitList;
  station_sec: SplitList;
  roxzone_sec: number | null;
  official_total_sec: number | null;
}

export interface ResultRaceOption {
  id: string;
  name: string;
  city: string;
  starts_at: string;
  division: Division | null;
}

export interface SimulationOption {
  session_id: string;
  ended_at: string;
  division: Division;
  active_sec: number;
  run_sec: SplitList;
  station_sec: SplitList;
}

export interface MyResults {
  results: HyroxResult[];
  races: ResultRaceOption[];
  simulations: SimulationOption[];
}

export const resultsApi = {
  mine: () => memberApi<MyResults>("/app/workout/results"),
  get: (id: string) => memberApi<{ result: HyroxResult; splits: SplitCompare[] }>(`/app/workout/results/${id}`),
  create: (
    input: ResultFields & { source: ResultSource; race_event_id: string | null; workout_session_id: string | null }
  ) => memberApi<{ id: string }>("/gym/results", { method: "POST", json: input }),
  update: (id: string, input: ResultFields) => memberApi<{ id: string }>(`/gym/results/${id}`, { method: "PUT", json: input }),
  leaderboard: (q: LeaderboardQuery) => memberApi<LeaderboardView>(`/app/workout/leaderboard?${leaderboardParams(q)}`),
};

export const useMyResults = () => useQuery({ queryKey: ["member-app", "results"], queryFn: resultsApi.mine });
export const useResult = (id: string) =>
  useQuery({ queryKey: ["member-app", "results", id], queryFn: () => resultsApi.get(id), enabled: Boolean(id) });
export const useLeaderboard = (q: LeaderboardQuery) =>
  useQuery({ queryKey: ["member-app", "leaderboard", q], queryFn: () => resultsApi.leaderboard(q) });

export const useExerciseLibrary = () =>
  useQuery({ queryKey: ["member-app", "workout", "exercises"], queryFn: api.workout.exercises, staleTime: Infinity });
export const useWorkout = (id: string) =>
  useQuery({ queryKey: ["member-app", "workout", id], queryFn: () => api.workout.get(id), enabled: Boolean(id) });
export const useWorkoutSessions = () =>
  useQuery({ queryKey: ["member-app", "workout", "sessions"], queryFn: api.workout.sessions });
export const useRaces = (query?: { region?: string; scope?: "upcoming" | "results" }) =>
  useQuery({
    queryKey: ["member-app", "races", query?.region ?? "", query?.scope ?? "upcoming"],
    queryFn: () => api.races.list(query),
  });
export const useMyRaces = () => useQuery({ queryKey: ["member-app", "races", "mine"], queryFn: api.races.mine });

/** Referensi menyegarkan semua query setelah mutasi. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
