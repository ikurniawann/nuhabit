import type { TrackPoint } from "../lib/queries-train";

/**
 * Dependency-free route renderer: projects the GPS polyline into an SVG.
 * (A tile map can replace this later without touching callers.)
 */
export function RouteMap({
  points,
  height = 160,
  className = "",
  emptyLabel = "No GPS track",
}: {
  points: TrackPoint[];
  height?: number;
  className?: string;
  emptyLabel?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-nh-raised text-xs font-bold uppercase tracking-wider text-nh-muted ${className}`}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const W = 400;
  const H = 200;
  const PAD = 14;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Meters-per-degree correction so the shape isn't stretched.
  const lngScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const spanLng = Math.max(maxLng - minLng, 1e-6) * lngScale;
  const scale = Math.min((W - PAD * 2) / spanLng, (H - PAD * 2) / spanLat);
  const offsetX = (W - spanLng * scale) / 2;
  const offsetY = (H - spanLat * scale) / 2;

  const toXY = (p: TrackPoint): [number, number] => [
    offsetX + (p.lng - minLng) * lngScale * scale,
    H - (offsetY + (p.lat - minLat) * scale),
  ];
  const path = points
    .map((p, i) => {
      const [x, y] = toXY(p);
      return `${i === 0 || p.segmentStart ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const [sx, sy] = toXY(points[0]!);
  const [ex, ey] = toXY(points[points.length - 1]!);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full rounded-xl bg-nh-raised ${className}`}
      style={{ height }}
      role="img"
      aria-label="Route map"
    >
      <path
        d={path}
        fill="none"
        stroke="#00281a"
        strokeWidth={3.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={sx}
        cy={sy}
        r={5}
        fill="#abde67"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <circle
        cx={ex}
        cy={ey}
        r={5}
        fill="#1c261b"
        stroke="#fff"
        strokeWidth={1.5}
      />
    </svg>
  );
}
