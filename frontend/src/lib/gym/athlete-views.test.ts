import { describe, expect, it } from "vitest";
import { AthleteError, nameOf, notFound, toActivity, toEffort, toGear, toRoute } from "./athlete-views";

const started = new Date("2026-10-01T06:00:00Z");

describe("toActivity", () => {
  const row = {
    id: "a1",
    customer_id: "m1",
    type: "RUN" as const,
    title: "Lari pagi",
    description: "",
    started_at: started,
    elapsed_sec: 1800,
    moving_sec: 1700,
    distance_m: "5012.40",
    avg_pace_sec_per_km: 339,
    elevation_gain_m: "12.5",
    visibility: "EVERYONE" as const,
    gear_id: null,
    photo_count: 0,
  };

  it("angka numeric Postgres jadi number, kolom camelCase", () => {
    expect(toActivity(row)).toMatchObject({
      id: "a1",
      memberId: "m1",
      distanceM: 5012.4,
      elevationGainM: 12.5,
      startedAt: started,
    });
  });

  it("ringkasan tanpa titik/foto: array kosong", () => {
    const activity = toActivity(row);
    expect(activity.points).toEqual([]);
    expect(activity.photos).toEqual([]);
  });
});

describe("toRoute", () => {
  it("titik ditipiskan ke batas yang diminta, tanggal ISO", () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ t: i, lat: -6.2 + i / 1000, lng: 106.8 }));
    const view = toRoute({ id: "r1", name: "GBK", distance_m: "2500", points, created_at: started }, 10);
    expect(view.distanceM).toBe(2500);
    expect(view.points.length).toBeLessThanOrEqual(10);
    expect(view.points[0]).toEqual(points[0]);
    expect(view.createdAt).toBe("2026-10-01T06:00:00.000Z");
  });
});

describe("toGear dan toEffort", () => {
  it("memetakan baris gear", () => {
    expect(
      toGear({ id: "g1", customer_id: "m1", name: "Pegasus", kind: "SHOES", distance_m: "120000", retired: false })
    ).toEqual({ id: "g1", memberId: "m1", name: "Pegasus", kind: "SHOES", distanceM: 120000, retired: false });
  });

  it("memetakan effort segment", () => {
    expect(toEffort({ segment_id: "s1", customer_id: "m1", elapsed_sec: 95, created_at: started })).toEqual({
      segmentId: "s1",
      memberId: "m1",
      elapsedSec: 95,
      createdAt: "2026-10-01T06:00:00.000Z",
    });
  });
});

describe("nameOf dan notFound", () => {
  it("nama atlet yang tidak dikenal jadi 'Athlete'", () => {
    const people = new Map([["m1", { id: "m1", name: "Rani", avatarUrl: null }]]);
    expect(nameOf(people, "m1")).toBe("Rani");
    expect(nameOf(people, "m2")).toBe("Athlete");
  });

  it("notFound = AthleteError 404 berpesan Indonesia", () => {
    const error = notFound("Rute");
    expect(error).toBeInstanceOf(AthleteError);
    expect(error).toMatchObject({ status: 404, message: "Rute tidak ditemukan" });
  });
});
