"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, ThumbsUp } from "lucide-react";
import { RouteMap } from "../components/route-map";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import {
  useFeed,
  useKudosMutation,
  useUnits,
  type ActivityCardView,
} from "../lib/queries-train";
import {
  EmptyState,
  Spinner,
  formatDayTime,
  formatDistanceM,
  formatDuration,
  formatPace,
  formatSpeedKmh,
} from "../ui";
import { TrainTabs } from "./train-tabs";

/** "RUN" → "Run". */
export const typeLabel = (type: string) =>
  type[0] + type.slice(1).toLowerCase();

export function ActivityStatsRow({ a }: { a: ActivityCardView }) {
  const units = useUnits();
  const t = useT();
  return (
    <div className="flex gap-5 text-sm">
      <div>
        <p className="nh-label !mb-0">{t("Distance")}</p>
        <p className="nh-display text-lg">
          {a.type === "WORKOUT" ? "-" : formatDistanceM(a.distanceM, units)}
        </p>
      </div>
      <div>
        <p className="nh-label !mb-0">
          {t(a.type === "RIDE" ? "Speed" : "Pace")}
        </p>
        <p className="nh-display text-lg">
          {a.type === "RIDE"
            ? formatSpeedKmh(a.distanceM, a.movingSec, units)
            : formatPace(a.avgPaceSecPerKm, units)}
        </p>
      </div>
      <div>
        <p className="nh-label !mb-0">{t("Time")}</p>
        <p className="nh-display text-lg">{formatDuration(a.movingSec)}</p>
      </div>
    </div>
  );
}

export function ActivityCard({ a }: { a: ActivityCardView }) {
  const kudos = useKudosMutation();
  const t = useT();
  return (
    <div className="nh-card !p-0">
      <Link
        href={m(`/train/athletes/${a.memberId}`)}
        className="flex items-center gap-3 px-4 pt-4"
      >
        {a.memberAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.memberAvatarUrl}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-nh-ink-soft text-sm font-black text-white">
            {initialsOf(a.memberName)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{a.memberName}</p>
          <p className="text-xs text-nh-muted">
            {formatDayTime(a.startedAt)} · {t(typeLabel(a.type))}
          </p>
        </div>
      </Link>
      <Link href={m(`/train/activities/${a.id}`)} className="block px-4 pt-3">
        <p className="nh-display text-xl">{a.title}</p>
        <div className="mt-2">
          <ActivityStatsRow a={a} />
        </div>
        {a.thumbnail.length > 1 ? (
          <div className="mt-3">
            <RouteMap points={a.thumbnail} height={140} />
          </div>
        ) : null}
      </Link>
      <div className="mt-2 flex items-center gap-4 border-t border-nh-line px-4 py-2.5">
        <button
          onClick={() => kudos.mutate(a.id)}
          disabled={kudos.isPending}
          aria-label="Kudos"
          className={`flex items-center gap-1.5 text-sm font-bold ${a.hasKudoed ? "text-nh-forest" : "text-nh-muted"}`}
        >
          <ThumbsUp size={16} fill={a.hasKudoed ? "currentColor" : "none"} />
          {a.kudosCount}
        </button>
        <Link
          href={m(`/train/activities/${a.id}`)}
          aria-label={t("Comments")}
          className="flex items-center gap-1.5 text-sm font-bold text-nh-muted"
        >
          <MessageCircle size={16} />
          {a.commentCount}
        </Link>
      </div>
    </div>
  );
}

export function FeedPage() {
  const t = useT();
  const [scope, setScope] = useState<"following" | "everyone">("everyone");
  const { data: feed, isLoading, error } = useFeed(scope);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("Train")}</h1>
      <TrainTabs />
      <div className="-mt-1 flex gap-2">
        {(["everyone", "following"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${
              scope === s ? "bg-nh-ink text-white" : "bg-nh-cream text-nh-muted"
            }`}
          >
            {t(s === "everyone" ? "Everyone" : "Following")}
          </button>
        ))}
      </div>
      {isLoading ? (
        <Spinner label={t("Loading feed…")} />
      ) : error ? (
        <p className="nh-card text-sm text-nh-danger">{error.message}</p>
      ) : !feed || feed.length === 0 ? (
        <EmptyState
          title={t("Quiet in here")}
          hint={t(
            scope === "following"
              ? "Follow athletes in Explore to fill your feed."
              : "Record your first activity!",
          )}
          action={
            <Link
              href={m("/train/record")}
              className="nh-btn-brand mt-2 !py-2 text-sm"
            >
              {t("Record an activity")}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {feed.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
