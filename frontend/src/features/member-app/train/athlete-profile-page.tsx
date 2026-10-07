"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, UserCheck, UserPlus } from "lucide-react";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import {
  trainApi,
  useAthleteProfile,
  useInvalidateAll,
} from "../lib/queries-train";
import { Spinner, formatDuration } from "../ui";
import { ActivityCard } from "./feed-page";
import { TotalsCard } from "./you-page";

export function AthleteProfilePage() {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const router = useRouter();
  const t = useT();
  const invalidate = useInvalidateAll();
  const { data: p, isLoading, error } = useAthleteProfile(memberId);

  if (error)
    return <p className="nh-card text-sm text-nh-muted">{error.message}</p>;
  if (isLoading || !p) return <Spinner label={t("Loading athlete…")} />;

  const toggleFollow = async () => {
    await trainApi.toggleFollow(p.member.id);
    invalidate();
  };

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm font-bold text-nh-muted"
      >
        <ArrowLeft size={16} /> {t("Back")}
      </button>

      <div className="flex items-center gap-4">
        {p.member.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.member.avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-nh-ink-soft text-xl font-black text-white">
            {initialsOf(p.member.fullName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="nh-display truncate text-2xl leading-tight">
            {p.member.fullName}
          </h1>
          <p className="text-sm text-nh-muted">
            {p.followerCount} {t("followers")} · {p.followingCount}{" "}
            {t("following")}
          </p>
        </div>
        {!p.isMe ? (
          <button
            onClick={() => void toggleFollow()}
            className={`${p.isFollowing ? "nh-btn-ghost" : "nh-btn-brand"} flex shrink-0 items-center gap-1.5 !px-4 !py-2.5 text-sm`}
          >
            {p.isFollowing ? <UserCheck size={15} /> : <UserPlus size={15} />}
            {t(p.isFollowing ? "Following" : "Follow")}
          </button>
        ) : null}
      </div>

      <TotalsCard
        cells={[
          { label: t("Activities"), value: p.totals.activities },
          {
            label: t("Distance"),
            value: `${p.totals.distanceKm.toFixed(0)} km`,
          },
          { label: t("Time"), value: formatDuration(p.totals.movingSec) },
        ]}
      />

      <section>
        <p className="mb-2 px-1 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
          {t("Recent activities")}
        </p>
        <div className="flex flex-col gap-3">
          {p.activities.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
          {p.activities.length === 0 ? (
            <p className="nh-card text-sm text-nh-muted">
              {t("No visible activities yet.")}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
