/** Klien API Gym → Stasiun & Latihan dan Race HYROX. */

import type { Division, ExerciseCategory } from "@/lib/gym/hyrox";
import type { MemberRaceStatus, RaceRegion, RaceStatus } from "@/lib/gym/races";

export interface ExerciseRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: ExerciseCategory;
  equipment: string[];
  hyrox_station_order: number | null;
  difficulty: 1 | 2 | 3;
  default_spec: { distanceM: number | null; reps: number | null };
  video_url: string | null;
  is_active: boolean;
}

export type ExerciseInput = Omit<ExerciseRow, "id"> & { id?: string };

export interface SubstitutionRow {
  id: string;
  original_exercise_id: string;
  original_name: string;
  alternative_exercise_id: string;
  alternative_name: string;
  similarity: number;
  volume_factor: number;
  conversion_note: string;
}

export interface SubstitutionInput {
  original_exercise_id: string;
  alternative_exercise_id: string;
  similarity: number;
  volume_factor: number;
  conversion_note: string;
}

export interface RaceEventRow {
  id: string;
  name: string;
  country: string;
  region: RaceRegion;
  city: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  registration_url: string;
  image_url: string | null;
  status: RaceStatus;
  training_count: number;
  raced_count: number;
}

export type RaceInput = Omit<RaceEventRow, "id" | "training_count" | "raced_count"> & { id?: string };

export interface RaceEntrant {
  id: string;
  customer_id: string;
  name: string | null;
  phone: string | null;
  division: Division;
  goal_sec: number | null;
  result_sec: number | null;
  status: MemberRaceStatus;
  created_at: string;
}

export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || "Permintaan gagal");
  return json.data as T;
}

export const post = <T>(url: string, body: unknown) => call<T>(url, { method: "POST", body: JSON.stringify(body) });
export const remove = <T>(url: string) => call<T>(url, { method: "DELETE" });

export const trainingApi = {
  library: () => call<{ exercises: ExerciseRow[]; substitutions: SubstitutionRow[] }>("/api/gym/exercises"),
  saveExercise: (input: ExerciseInput) => post<{ id: string }>("/api/gym/exercises", input),
  deleteExercise: (id: string) => remove<{ id: string }>(`/api/gym/exercises?id=${id}`),
  saveSubstitution: (input: SubstitutionInput) => post<{ id: string }>("/api/gym/exercises/substitutions", input),
  deleteSubstitution: (id: string) => remove<{ id: string }>(`/api/gym/exercises/substitutions?id=${id}`),

  races: () => call<RaceEventRow[]>("/api/gym/races"),
  saveRace: (input: RaceInput) => post<{ id: string }>("/api/gym/races", input),
  deleteRace: (id: string) => remove<{ id: string; outcome: "deleted" | "cancelled" }>(`/api/gym/races?id=${id}`),
  entrants: (raceId: string) => call<RaceEntrant[]>(`/api/gym/races/${raceId}/entrants`),
};
