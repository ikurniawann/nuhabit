"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Crown } from "lucide-react";
import { useT } from "../lib/i18n";
import { useSegment, useUnits } from "../lib/queries-train";
import { Spinner, formatDay, formatDistanceM, formatDuration } from "../ui";
import { typeLabel } from "./feed-page";

export function SegmentPage() {
  const { segmentId = "" } = useParams<{ segmentId: string }>();
  const router = useRouter();
  const t = useT();
  const units = useUnits();
  const { data: v, isLoading, error } = useSegment(segmentId);

  if (error)
    return <p className="nh-card text-sm text-nh-muted">{error.message}</p>;
  if (isLoading || !v) return <Spinner label={t("Loading segment…")} />;

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm font-bold text-nh-muted"
      >
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <h1 className="nh-display text-3xl">{v.segment.name}</h1>
        <p className="text-nh-muted">
          {formatDistanceM(v.segment.distanceM, units)} ·{" "}
          {t(typeLabel(v.segment.type))} · {v.segment.location}
        </p>
        {v.myRank ? (
          <p className="mt-1 text-sm font-black text-nh-forest">
            {t("Your rank")}: #{v.myRank}
          </p>
        ) : null}
      </div>
      <div className="nh-card !p-0">
        <p className="nh-label px-4 pt-4">
          {t("Leaderboard (best effort per athlete)")}
        </p>
        <div className="flex flex-col">
          {v.leaderboard.map((row) => (
            <div
              key={row.memberId}
              className={`flex items-center justify-between border-t border-nh-line px-4 py-2.5 text-sm ${
                row.isMe ? "bg-nh-forest/5 font-black text-nh-forest" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 font-black">{row.rank}</span>
                {row.rank === 1 ? (
                  <Crown size={14} className="text-nh-forest" />
                ) : null}
                <span className="font-bold">{row.memberName}</span>
              </div>
              <div className="text-right">
                <p className="font-black">{formatDuration(row.elapsedSec)}</p>
                <p className="text-xs text-nh-muted">
                  {formatDay(row.createdAt)}
                </p>
              </div>
            </div>
          ))}
          {v.leaderboard.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-nh-muted">
              {t("No efforts yet - be the first!")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
