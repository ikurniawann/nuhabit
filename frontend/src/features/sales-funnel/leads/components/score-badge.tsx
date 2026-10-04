"use client";

import { Badge } from "@/components/ui/badge";
import { SCORE_BAND_LABELS, scoreBand } from "@/lib/crm/scoring";

const BAND_CLASS = {
  hot: "border-0 bg-red-100 font-semibold text-red-700",
  warm: "border-0 bg-amber-100 font-semibold text-amber-700",
  cold: "border-0 bg-gray-100 font-normal text-gray-500",
} as const;

/** EPIC-050 T-2.2 — badge skor lead: Hot ≥ 70, Warm ≥ 40. */
export function ScoreBadge({ score, showLabel = true }: { score: number; showLabel?: boolean }) {
  const band = scoreBand(score);
  return (
    <Badge className={BAND_CLASS[band]} title={`Skor lead ${score}`}>
      {score}
      {showLabel ? ` · ${SCORE_BAND_LABELS[band]}` : ""}
    </Badge>
  );
}
