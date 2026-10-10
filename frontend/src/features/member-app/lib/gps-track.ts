import { haversineM, type TrackPoint } from "@/lib/gym/athlete";

export interface GpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
  at: number;
  altitude?: number;
}

export interface AcceptedFix {
  point: TrackPoint;
  accuracyM: number;
  at: number;
}

/** Keep route geometry and distance in sync by applying the same filter to both. */
export function acceptGpsFix(
  fix: GpsFix,
  previous: AcceptedFix | null,
  startedAt: number,
  kind: "RUN" | "RIDE" | "WALK",
  newSegment = false,
): { accepted: AcceptedFix; distanceM: number } | null {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    !Number.isFinite(fix.accuracyM) ||
    !Number.isFinite(fix.at) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180 ||
    fix.accuracyM < 0 ||
    fix.accuracyM > 50 ||
    fix.at < startedAt - 5000
  ) return null;

  const point: TrackPoint = {
    t: Math.max(0, fix.at - startedAt),
    lat: fix.lat,
    lng: fix.lng,
    ...(fix.altitude !== undefined && Number.isFinite(fix.altitude)
      ? { ele: fix.altitude }
      : {}),
  };
  if (!previous) {
    return { accepted: { point, accuracyM: fix.accuracyM, at: fix.at }, distanceM: 0 };
  }
  if (fix.at <= previous.at) return null;

  const gapSec = (fix.at - previous.at) / 1000;
  const distanceM = haversineM(previous.point, point);
  const segmentStart = newSegment || gapSec > 30;
  if (!segmentStart) {
    // A moving phone can wander several metres while it sits still.
    const noiseM = Math.max(5, Math.min(15, (fix.accuracyM + previous.accuracyM) / 2));
    if (distanceM < noiseM) return null;
    const maxSpeedMps = kind === "RIDE" ? 25 : kind === "RUN" ? 9 : 4;
    if (distanceM / gapSec > maxSpeedMps) return null;
  }
  if (segmentStart) point.segmentStart = true;
  return {
    accepted: { point, accuracyM: fix.accuracyM, at: fix.at },
    distanceM: segmentStart ? 0 : distanceM,
  };
}
