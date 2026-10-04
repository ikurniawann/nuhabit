"use client";

import { cn } from "@/lib/utils";

const MAX_VISIBLE_CHAIRS = 12;

/** Nomor pendek ("12", "5-01") ditulis besar; label panjang mengecil agar muat di meja. */
function labelFontSize(label: string): number {
  if (label.length <= 2) return 24;
  if (label.length <= 4) return 17;
  if (label.length <= 6) return 13;
  return 11;
}

type TableSilhouetteProps = {
  capacity: number;
  className?: string;
  /** Shown centered on the table top */
  label?: string;
};

/**
 * Top-down dining table silhouette (diamond table + chairs).
 * Chair count follows `capacity` (clamped 1–12).
 */
export function TableSilhouette({
  capacity,
  className,
  label,
}: TableSilhouetteProps) {
  const seats = Math.max(
    1,
    Math.min(MAX_VISIBLE_CHAIRS, Math.floor(Number(capacity)) || 1)
  );

  const chairs = Array.from({ length: seats }, (_, i) => {
    // -90° = top → 4 seats match the reference icon layout.
    const deg = (i / seats) * 360 - 90;
    return { key: i, deg };
  });

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("h-full w-full overflow-visible", className)}
      aria-hidden={!label}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {chairs.map(({ key, deg }) => (
        <g key={key} transform={`rotate(${deg + 90} 50 50)`}>
          {/* Chair drawn at top of viewBox, then rotated around center */}
          <g transform="translate(50 13)">
            {/* Seat diamond */}
            <rect
              x="-5"
              y="-5"
              width="10"
              height="10"
              rx="1.4"
              fill="currentColor"
              transform="rotate(45)"
            />
            {/* Outer arm / back bars (flanking the outward vertex) */}
            <rect
              x="-10.5"
              y="-6.5"
              width="2.8"
              height="9"
              rx="1.4"
              fill="currentColor"
              transform="rotate(-40)"
            />
            <rect
              x="7.7"
              y="-6.5"
              width="2.8"
              height="9"
              rx="1.4"
              fill="currentColor"
              transform="rotate(40)"
            />
          </g>
        </g>
      ))}

      {/* Central table on top so label stays readable */}
      <rect
        x="28"
        y="28"
        width="44"
        height="44"
        rx="5"
        ry="5"
        fill="currentColor"
        transform="rotate(45 50 50)"
      />

      {label ? (
        <text
          x="50"
          y="52.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#ffffff"
          fontSize={labelFontSize(label)}
          fontWeight="800"
          letterSpacing="-0.5"
        >
          {label.length > 7 ? `${label.slice(0, 6)}…` : label}
        </text>
      ) : null}
    </svg>
  );
}
