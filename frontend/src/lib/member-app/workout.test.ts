import { describe, expect, it } from "vitest";
import type { WorkoutBlock } from "@/lib/gym/hyrox";
import type { MemberRaceView, RaceEventRow } from "@/lib/gym/races-server";
import type { WorkoutHistoryItem, WorkoutSessionView } from "@/lib/gym/training-server";
import {
  flattenWorkoutHistory,
  parseHms,
  raceImagePath,
  toMyRace,
  toRaceEvent,
  toSessionView,
  toWorkout,
  youtubeEmbedUrl,
  youtubeVideoId,
} from "./workout";

const asset = (path: string) => `/member-assets${path}`;

const block = (order: number): WorkoutBlock => ({
  order,
  kind: order % 2 ? "RUN" : "STATION",
  exerciseId: `ex${order}`,
  exerciseName: `Ex ${order}`,
  originalExerciseId: null,
  originalExerciseName: null,
  similarity: null,
  distanceM: 1000,
  reps: null,
  weightNote: null,
  targetSec: 300,
  videoUrl: null,
});

const sessionRow = (over: Partial<WorkoutSessionView> = {}): WorkoutSessionView => ({
  id: "s1",
  workout_id: "w1",
  status: "started",
  current_block: 2,
  started_at: "2026-10-01T00:00:00Z",
  ended_at: null,
  paused_at: null,
  block_results: [{ order: 1, durationSec: 280 }],
  pause_count: 0,
  total_pause_sec: 0,
  active_sec: 280,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

const eventRow = (over: Partial<RaceEventRow> = {}): RaceEventRow => ({
  id: "r1",
  name: "HYROX Jakarta",
  country: "Indonesia",
  region: "ASIA",
  city: "Jakarta",
  venue: "JIExpo",
  starts_at: "2026-12-05T00:00:00Z",
  ends_at: "2026-12-06T00:00:00Z",
  registration_url: "https://hyrox.com",
  image_url: null,
  status: "registration_open",
  ...over,
});

describe("workout adapters", () => {
  const workout = toWorkout({ id: "w1", type: "QUICK", division: "MEN_OPEN", blocks: [block(1), block(2)], total_target_sec: 600 });

  it("maps a session to the reference view with active time and completion", () => {
    const view = toSessionView(sessionRow(), workout);
    expect(view.session.status).toBe("STARTED");
    expect(view.session.currentBlock).toBe(2);
    expect(view.activeSec).toBe(280);
    expect(view.completionPct).toBe(50);
    expect(view.workout.totalTargetSec).toBe(600);
  });

  it("flattens history to one row per session, newest first", () => {
    const history: WorkoutHistoryItem[] = [
      {
        id: "w1",
        type: "QUICK",
        division: "WOMEN_PRO",
        blocks: [block(1), block(2)],
        total_target_sec: 600,
        excluded_exercise_ids: [],
        available_equipment: null,
        created_at: "2026-10-01T00:00:00Z",
        sessions: [
          sessionRow({ id: "old", created_at: "2026-10-01T00:00:00Z" }),
          sessionRow({ id: "new", status: "completed", created_at: "2026-10-02T00:00:00Z" }),
        ],
      },
      { ...workout, total_target_sec: 600, excluded_exercise_ids: [], available_equipment: null, created_at: "", sessions: [] },
    ];
    const items = flattenWorkoutHistory(history);
    expect(items.map((i) => i.session.id)).toEqual(["new", "old"]);
    expect(items[0]).toMatchObject({ workoutType: "QUICK", division: "WOMEN_PRO", totalBlocks: 2, completionPct: 50 });
    expect(items[0]!.session.status).toBe("COMPLETED");
  });
});

describe("race adapters", () => {
  it("maps known cities to their photo", () => {
    expect(raceImagePath("Jakarta")).toBe("/img/race-jakarta.jpg");
    expect(raceImagePath("Kuala Lumpur")).toBe("/img/race-kualalumpur.jpg");
    expect(raceImagePath("Hong Kong")).toBe("/img/race-hongkong.jpg");
    expect(raceImagePath("Surabaya")).toBeNull();
  });

  it("prefers a stored image, then the city photo", () => {
    expect(toRaceEvent(eventRow(), asset).imageUrl).toBe("/member-assets/img/race-jakarta.jpg");
    expect(toRaceEvent(eventRow({ image_url: "https://cdn/x.jpg" }), asset).imageUrl).toBe("https://cdn/x.jpg");
    expect(toRaceEvent(eventRow({ city: "Surabaya" }), asset).imageUrl).toBeNull();
    expect(toRaceEvent(eventRow(), asset).status).toBe("REGISTRATION_OPEN");
  });

  it("builds My Races rows with member-wide readiness", () => {
    const row: MemberRaceView = {
      id: "e1",
      race_event_id: "r1",
      division: "MEN_PRO",
      goal_sec: 5400,
      result_sec: 5300,
      status: "raced",
      created_at: "",
      event: eventRow(),
      days_until: 0,
      prediction_sec: 5500,
      analysis: { vsGoalSec: -100, vsPredictionSec: -200, achievedGoal: true },
    };
    const view = toMyRace(row, { readiness: 75, simulationCount: 3 }, asset);
    expect(view.userRace).toMatchObject({ id: "e1", status: "RACED", goalSec: 5400, resultSec: 5300 });
    expect(view).toMatchObject({ readinessScore: 75, simulationCount: 3, predictionSec: 5500, daysToRace: 0 });
  });

  it("parses hh:mm:ss only", () => {
    expect(parseHms("01:30:00")).toBe(5400);
    expect(parseHms(" 1:05:09 ")).toBe(3909);
    expect(parseHms("90:00")).toBeNull();
    expect(parseHms("")).toBeNull();
  });
});

describe("youtube links", () => {
  it("extracts ids from watch, short and embed links", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=abc123XYZ&t=4")).toBe("abc123XYZ");
    expect(youtubeVideoId("https://youtu.be/abc123XYZ")).toBe("abc123XYZ");
    expect(youtubeVideoId("https://www.youtube.com/embed/abc123XYZ")).toBe("abc123XYZ");
  });

  it("does not embed search links", () => {
    const search = "https://www.youtube.com/results?search_query=hyrox+skierg+technique";
    expect(youtubeVideoId(search)).toBeNull();
    expect(youtubeEmbedUrl(search)).toBeNull();
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=abc123XYZ")).toBe("https://www.youtube.com/embed/abc123XYZ");
  });
});
