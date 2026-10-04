import { describe, expect, it } from "vitest";
import {
  bestPerMember,
  canViewActivity,
  challengeProgressKm,
  computeActivityStats,
  defaultActivityTitle,
  downsample,
  findGroupedActivities,
  followSuggestions,
  gearKindFor,
  gearMileageMoves,
  haversineM,
  isChallengeRunning,
  matchSegments,
  personalRecords,
  placeEffort,
  rankOf,
  resolveActivityFigures,
  roundKm,
  selectFeed,
  startOfWeek,
  topOf,
  weeklyBuckets,
  weeklyGoalProgress,
  weeklyKmByMember,
  workoutActivityTitle,
  workoutRunDistanceM,
  type TrackPoint,
} from "./athlete";

/** Garis lurus ke utara: tiap langkah `stepM` meter dalam `stepSec` detik. */
function northTrack(
  steps: number,
  stepM: number,
  stepSec: number,
  from = { lat: -6.229, lng: 106.808 },
): TrackPoint[] {
  const dLat = stepM / 111_195; // meter per derajat lintang (R = 6 371 km)
  return Array.from({ length: steps + 1 }, (_, i) => ({
    t: i * stepSec * 1000,
    lat: from.lat + i * dLat,
    lng: from.lng,
  }));
}

describe("haversineM", () => {
  it("measures one degree of latitude as ~111 km", () => {
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(
      111_195,
      -1,
    );
  });
  it("is zero for the same point", () => {
    expect(
      haversineM({ lat: -6.2, lng: 106.8 }, { lat: -6.2, lng: 106.8 }),
    ).toBe(0);
  });
});

describe("computeActivityStats", () => {
  it("returns empty stats below two points", () => {
    const s = computeActivityStats([{ t: 5000, lat: 0, lng: 0 }]);
    expect(s).toMatchObject({
      distanceM: 0,
      elapsedSec: 5,
      movingSec: 0,
      avgPaceSecPerKm: null,
      splits: [],
    });
  });

  it("computes distance, pace and full splits", () => {
    // 2.5 km at 10 m per 3 s -> 300 s/km
    const s = computeActivityStats(northTrack(250, 10, 3));
    expect(s.distanceM).toBe(2500);
    expect(s.elapsedSec).toBe(750);
    expect(s.movingSec).toBe(750);
    expect(s.avgPaceSecPerKm).toBe(300);
    expect(s.splits.map((x) => [x.km, x.full, x.paceSecPerKm])).toEqual([
      [1, true, 300],
      [2, true, 300],
      [3, false, 300],
    ]);
    expect(s.splits[2]!.distanceM).toBe(500);
    expect(s.bestSplitPaceSec).toBe(300);
  });

  it("counts stopped gaps as elapsed but not moving", () => {
    const track = northTrack(10, 10, 3);
    track.push({
      ...track[track.length - 1]!,
      t: track[track.length - 1]!.t + 60_000,
    }); // berdiri 60 s
    const s = computeActivityStats(track);
    expect(s.elapsedSec).toBe(90);
    expect(s.movingSec).toBe(30);
  });

  it("adds elevation gain above the jitter threshold only", () => {
    const track = northTrack(3, 10, 3).map((p, i) => ({
      ...p,
      ele: [10, 10.2, 12, 11][i],
    }));
    expect(computeActivityStats(track).elevationGainM).toBe(2);
  });

  it("drops a tiny trailing split under 50 m", () => {
    const s = computeActivityStats(northTrack(102, 10, 3));
    expect(s.splits).toHaveLength(1);
  });
});

describe("resolveActivityFigures", () => {
  it("trusts the track over client figures", () => {
    const f = resolveActivityFigures(northTrack(100, 10, 3), {
      elapsedSec: 9999,
      distanceM: 99_999,
    });
    expect(f.distanceM).toBe(1000);
    expect(f.elapsedSec).toBe(300);
  });
  it("uses manual figures without a track", () => {
    expect(resolveActivityFigures([], { elapsedSec: 2400 })).toEqual({
      elapsedSec: 2400,
      movingSec: 2400,
      distanceM: 0,
      avgPaceSecPerKm: null,
      elevationGainM: 0,
    });
  });
});

describe("downsample", () => {
  it("keeps short tracks whole", () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
  it("keeps first and last and caps the length", () => {
    const out = downsample(
      Array.from({ length: 101 }, (_, i) => i),
      5,
    );
    expect(out).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("defaultActivityTitle", () => {
  it("names the day part in studio time (WIB)", () => {
    expect(defaultActivityTitle("RUN", new Date("2026-10-03T23:30:00Z"))).toBe(
      "Morning run",
    ); // 06:30 WIB
    expect(defaultActivityTitle("RIDE", new Date("2026-10-03T07:00:00Z"))).toBe(
      "Afternoon ride",
    ); // 14:00
    expect(defaultActivityTitle("WALK", new Date("2026-10-03T12:00:00Z"))).toBe(
      "Evening walk",
    ); // 19:00
  });
});

describe("visibility and feed", () => {
  const follows = new Set(["b"]);
  it("applies EVERYONE / FOLLOWERS / PRIVATE", () => {
    const can = (
      memberId: string,
      visibility: "EVERYONE" | "FOLLOWERS" | "PRIVATE",
    ) =>
      canViewActivity({ memberId, visibility }, "me", (id) => follows.has(id));
    expect(can("me", "PRIVATE")).toBe(true);
    expect(can("x", "EVERYONE")).toBe(true);
    expect(can("b", "FOLLOWERS")).toBe(true);
    expect(can("x", "FOLLOWERS")).toBe(false);
    expect(can("b", "PRIVATE")).toBe(false);
  });

  it("filters the feed by scope and limit", () => {
    const candidates = [
      { id: "1", memberId: "x", visibility: "EVERYONE" as const },
      { id: "2", memberId: "b", visibility: "FOLLOWERS" as const },
      { id: "3", memberId: "x", visibility: "PRIVATE" as const },
      { id: "4", memberId: "me", visibility: "PRIVATE" as const },
    ];
    expect(
      selectFeed(candidates, "me", follows, false).map((a) => a.id),
    ).toEqual(["1", "2", "4"]);
    expect(
      selectFeed(candidates, "me", follows, true).map((a) => a.id),
    ).toEqual(["2", "4"]);
    expect(
      selectFeed(candidates, "me", follows, false, 1).map((a) => a.id),
    ).toEqual(["1"]);
  });
});

describe("matchSegments", () => {
  const track = northTrack(300, 10, 3); // 3 km ke utara
  const segment = {
    id: "s1",
    type: "RUN" as const,
    distanceM: 1000,
    path: [track[100]!, track[150]!, track[200]!],
  };

  it("matches a track through both gates with the right distance", () => {
    const [m] = matchSegments([segment], "RUN", track);
    expect(m).toBeDefined();
    expect(m!.elapsedSec).toBeGreaterThanOrEqual(270);
    expect(m!.elapsedSec).toBeLessThanOrEqual(330);
  });

  it("ignores other activity types", () => {
    expect(matchSegments([segment], "RIDE", track)).toEqual([]);
  });

  it("rejects a track that never reaches the end gate", () => {
    expect(matchSegments([segment], "RUN", track.slice(0, 150))).toEqual([]);
  });

  it("rejects a detour far longer than the segment", () => {
    const short = { ...segment, distanceM: 500 };
    expect(matchSegments([short], "RUN", track)).toEqual([]);
  });
});

describe("leaderboards", () => {
  const efforts = [
    { memberId: "a", elapsedSec: 300 },
    { memberId: "b", elapsedSec: 280 },
    { memberId: "a", elapsedSec: 270 },
    { memberId: "c", elapsedSec: 310 },
  ];

  it("keeps one best effort per athlete, fastest first", () => {
    expect(bestPerMember(efforts)).toEqual([
      { memberId: "a", elapsedSec: 270 },
      { memberId: "b", elapsedSec: 280 },
      { memberId: "c", elapsedSec: 310 },
    ]);
  });

  it("ranks an athlete on the board", () => {
    const board = bestPerMember(efforts);
    expect(rankOf(board, "b")).toBe(2);
    expect(rankOf(board, "z")).toBeNull();
  });

  it("places an effort and flags personal bests", () => {
    expect(placeEffort({ memberId: "a", elapsedSec: 270 }, efforts)).toEqual({
      rank: 1,
      totalEfforts: 3,
      isPersonalBest: true,
    });
    expect(
      placeEffort({ memberId: "a", elapsedSec: 300 }, efforts).isPersonalBest,
    ).toBe(false);
  });

  it("tops a km board at five rows", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      memberName: `m${i}`,
      km: i,
      isMe: i === 2,
    }));
    expect(topOf(rows).map((r) => r.km)).toEqual([6, 5, 4, 3, 2]);
  });
});

describe("findGroupedActivities", () => {
  const base = {
    id: "a1",
    memberId: "me",
    type: "RUN" as const,
    startedAt: "2026-10-01T23:00:00Z",
    start: { lat: -6.229, lng: 106.808 },
  };
  it("finds nearby same-type activities by other athletes in the window", () => {
    const pool = [
      {
        ...base,
        id: "x1",
        memberId: "rina",
        startedAt: "2026-10-01T23:20:00Z",
      },
      {
        ...base,
        id: "x2",
        memberId: "rina",
        startedAt: "2026-10-02T01:00:00Z",
      },
      { ...base, id: "x3", memberId: "budi", type: "RIDE" as const },
      {
        ...base,
        id: "x4",
        memberId: "budi",
        start: { lat: -6.24, lng: 106.808 },
      },
      { ...base, id: "x5" },
    ];
    expect(findGroupedActivities(base, pool)).toEqual(["x1"]);
  });
  it("returns nothing without a start point", () => {
    expect(findGroupedActivities({ ...base, start: null }, [base])).toEqual([]);
  });
});

describe("challenges", () => {
  const challenge = {
    type: "RUN" as const,
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: "2026-10-31T23:59:59Z",
  };
  const acts = [
    {
      type: "RUN" as const,
      distanceM: 5049,
      startedAt: "2026-10-02T00:00:00Z",
    },
    {
      type: "RIDE" as const,
      distanceM: 20_000,
      startedAt: "2026-10-02T00:00:00Z",
    },
    {
      type: "RUN" as const,
      distanceM: 10_000,
      startedAt: "2026-09-30T00:00:00Z",
    },
  ];
  it("sums matching activities inside the window, rounded to 0.1 km", () => {
    expect(challengeProgressKm(challenge, acts)).toBe(5);
    expect(challengeProgressKm({ ...challenge, type: "ANY" }, acts)).toBe(25);
  });
  it("is running until it ends", () => {
    expect(
      isChallengeRunning(challenge, new Date("2026-10-31T00:00:00Z")),
    ).toBe(true);
    expect(
      isChallengeRunning(challenge, new Date("2026-11-01T00:00:00Z")),
    ).toBe(false);
  });
  it("rounds metres to km", () => {
    expect(roundKm(1250)).toBe(1.3);
    expect(roundKm(0)).toBe(0);
  });
});

describe("weeks and stats", () => {
  // Sabtu 3 Okt 2026 22:00 WIB = 15:00 UTC
  const now = new Date("2026-10-03T15:00:00Z");

  it("starts the week on Monday 00:00 WIB", () => {
    expect(startOfWeek(now).toISOString()).toBe("2026-09-27T17:00:00.000Z"); // Sen 28 Sep 00:00 WIB
    // Senin 00:30 WIB masih minggu yang sama dengan Senin itu sendiri.
    expect(startOfWeek(new Date("2026-09-27T17:30:00Z")).toISOString()).toBe(
      "2026-09-27T17:00:00.000Z",
    );
  });

  it("buckets eight weeks oldest first, keeping empty weeks", () => {
    const buckets = weeklyBuckets(
      [
        { startedAt: "2026-10-01T00:00:00Z", distanceM: 5000, movingSec: 1500 },
        { startedAt: "2026-09-29T00:00:00Z", distanceM: 2549, movingSec: 900 },
        {
          startedAt: "2026-09-22T00:00:00Z",
          distanceM: 10_000,
          movingSec: 3000,
        },
      ],
      now,
    );
    expect(buckets).toHaveLength(8);
    expect(buckets[7]).toMatchObject({
      distanceKm: 7.5,
      activities: 2,
      movingSec: 2400,
    });
    expect(buckets[6]).toMatchObject({ distanceKm: 10, activities: 1 });
    expect(buckets[0]).toMatchObject({ distanceKm: 0, activities: 0 });
  });

  it("totals this week's km per member", () => {
    const km = weeklyKmByMember(
      [
        {
          memberId: "a",
          startedAt: "2026-10-01T00:00:00Z",
          distanceM: 4000,
          movingSec: 1,
        },
        {
          memberId: "a",
          startedAt: "2026-10-02T00:00:00Z",
          distanceM: 1000,
          movingSec: 1,
        },
        {
          memberId: "b",
          startedAt: "2026-09-20T00:00:00Z",
          distanceM: 9000,
          movingSec: 1,
        },
      ],
      now,
    );
    expect(km.get("a")).toBe(5);
    expect(km.has("b")).toBe(false);
  });

  it("computes personal records from runs", () => {
    const prs = personalRecords([
      {
        type: "RUN",
        distanceM: 10_000,
        movingSec: 3300,
        points: northTrack(110, 10, 3),
      },
      { type: "RUN", distanceM: 5000, movingSec: 1400, points: [] },
      { type: "RIDE", distanceM: 30_000, movingSec: 3600, points: [] },
    ]);
    expect(prs.best1kPaceSec).toBe(300);
    expect(prs.best5kSec).toBe(1400);
    expect(prs.best10kSec).toBe(3300);
    expect(prs.longestDistanceM).toBe(30_000);
    expect(prs.longestMovingSec).toBe(3600);
  });

  it("returns empty records without runs", () => {
    expect(personalRecords([])).toEqual({
      best1kPaceSec: null,
      best5kSec: null,
      best10kSec: null,
      longestDistanceM: 0,
      longestMovingSec: 0,
    });
  });

  it("caps weekly goal progress at 100%", () => {
    expect(weeklyGoalProgress(20, 5)).toBe(0.25);
    expect(weeklyGoalProgress(20, 40)).toBe(1);
    expect(weeklyGoalProgress(null, 5)).toBe(0);
  });
});

describe("gear", () => {
  it("moves mileage between gear", () => {
    expect(gearMileageMoves("g1", "g2", 5000)).toEqual([
      { gearId: "g1", deltaM: -5000 },
      { gearId: "g2", deltaM: 5000 },
    ]);
    expect(gearMileageMoves("g1", null, 5000)).toEqual([
      { gearId: "g1", deltaM: -5000 },
    ]);
    expect(gearMileageMoves("g1", "g1", 5000)).toEqual([]);
    expect(gearMileageMoves(null, "g2", 0)).toEqual([]);
  });
  it("pairs bikes with rides and shoes with runs and walks", () => {
    expect(gearKindFor("RIDE")).toBe("BIKE");
    expect(gearKindFor("WALK")).toBe("SHOES");
    expect(gearKindFor("WORKOUT")).toBeNull();
  });
});

describe("social and workouts", () => {
  it("suggests active training athletes not yet followed", () => {
    expect(
      followSuggestions(
        ["me", "a", "b", "c", "d"],
        "me",
        new Set(["a"]),
        new Set(["a", "b", "d"]),
        1,
      ),
    ).toEqual(["b"]);
  });
  it("counts only run blocks as workout distance", () => {
    expect(
      workoutRunDistanceM([
        { kind: "RUN", distanceM: 1000 },
        { kind: "STATION", distanceM: 50 },
        { kind: "RUN", distanceM: null },
      ]),
    ).toBe(1000);
  });
  it("titles workouts like the reference", () => {
    expect(workoutActivityTitle("FULL_SIMULATION")).toBe("HYROX simulation");
    expect(workoutActivityTitle("PRACTICE")).toBe("HYROX station practice");
  });
});
