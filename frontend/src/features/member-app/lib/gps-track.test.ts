import { describe, expect, it } from "vitest";
import { computeActivityStats, downsampleTrack } from "@/lib/gym/athlete";
import { acceptGpsFix } from "./gps-track";

const start = 1_000_000;
const fix = (lat: number, seconds: number, accuracyM = 5) => ({
  lat,
  lng: 106.8,
  accuracyM,
  at: start + seconds * 1000,
});

describe("GPS recording", () => {
  it("ignores stationary drift and implausible jumps", () => {
    const first = acceptGpsFix(fix(-6.2, 0), null, start, "RUN")!;
    expect(acceptGpsFix(fix(-6.20002, 5), first.accepted, start, "RUN")).toBeNull();
    expect(acceptGpsFix(fix(-6.19, 6), first.accepted, start, "RUN")).toBeNull();
    const next = acceptGpsFix(fix(-6.2001, 10), first.accepted, start, "RUN")!;
    expect(next.distanceM).toBeGreaterThan(10);
    expect(next.distanceM).toBeLessThan(12);
  });

  it("does not add distance across pauses or signal outages", () => {
    const first = acceptGpsFix(fix(-6.2, 0), null, start, "RUN")!;
    const afterPause = acceptGpsFix(fix(-6.201, 60), first.accepted, start, "RUN", true)!;
    expect(afterPause.distanceM).toBe(0);
    expect(afterPause.accepted.point.segmentStart).toBe(true);
    const next = acceptGpsFix(fix(-6.2011, 70), afterPause.accepted, start, "RUN")!;
    const stats = computeActivityStats([
      first.accepted.point,
      afterPause.accepted.point,
      next.accepted.point,
    ]);
    expect(stats.distanceM).toBeGreaterThan(10);
    expect(stats.distanceM).toBeLessThan(12);
  });

  it("rejects stale and low accuracy fixes", () => {
    expect(acceptGpsFix(fix(-6.2, -10), null, start, "WALK")).toBeNull();
    expect(acceptGpsFix(fix(-6.2, 0, 90), null, start, "WALK")).toBeNull();
  });

  it("keeps a route break when the map uses fewer points", () => {
    const points = Array.from({ length: 9 }, (_, t) => ({
      t,
      lat: -6.2 + t * 0.0001,
      lng: 106.8,
      ...(t === 5 ? { segmentStart: true } : {}),
    }));
    const sampled = downsampleTrack(points, 3);
    expect(sampled.map((p) => p.segmentStart ?? false)).toEqual([false, false, true]);
  });
});
