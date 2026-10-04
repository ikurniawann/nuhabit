"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Trash2, Trophy, Users } from "lucide-react";
import { RouteMap } from "../components/route-map";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import {
  trainApi,
  useChallenges,
  useClubs,
  useFollowMutation,
  useInvalidateAll,
  useRoutes,
  useSegments,
  useSocial,
  useUnits,
} from "../lib/queries-train";
import { Spinner, formatDay, formatDistanceM, formatDuration } from "../ui";
import { TrainTabs } from "./train-tabs";

const TABS = ["Segments", "Routes", "Challenges", "Clubs", "Athletes"] as const;
type Tab = (typeof TABS)[number];

export function ExplorePage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("Segments");
  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("Explore")}</h1>
      <TrainTabs />
      <div className="-mt-1 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold whitespace-nowrap ${
              tab === name
                ? "bg-nh-ink text-white"
                : "bg-nh-cream text-nh-muted"
            }`}
          >
            {t(name)}
          </button>
        ))}
      </div>
      {tab === "Segments" ? <SegmentsTab /> : null}
      {tab === "Routes" ? <RoutesTab /> : null}
      {tab === "Challenges" ? <ChallengesTab /> : null}
      {tab === "Clubs" ? <ClubsTab /> : null}
      {tab === "Athletes" ? <AthletesTab /> : null}
    </div>
  );
}

/** Top-five km board (challenges and clubs). */
function KmBoard({
  rows,
}: {
  rows: { memberName: string; km: number; isMe: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {rows.map((r, i) => (
        <div
          key={r.memberName}
          className={`flex justify-between ${r.isMe ? "font-black text-nh-forest" : ""}`}
        >
          <span>
            {i + 1}. {r.memberName}
          </span>
          <span>{r.km.toFixed(1)} km</span>
        </div>
      ))}
    </div>
  );
}

function SegmentsTab() {
  const t = useT();
  const units = useUnits();
  const { data, isLoading } = useSegments();
  if (isLoading) return <Spinner label={t("Loading segments…")} />;
  if (!data || data.length === 0)
    return (
      <p className="nh-card text-sm text-nh-muted">{t("No segments yet.")}</p>
    );
  return (
    <div className="flex flex-col gap-2">
      {data.map((v) => (
        <Link
          key={v.segment.id}
          href={m(`/train/segments/${v.segment.id}`)}
          className="nh-card flex items-center justify-between"
        >
          <div>
            <p className="font-black">{v.segment.name}</p>
            <p className="text-sm text-nh-muted">
              {formatDistanceM(v.segment.distanceM, units)} ·{" "}
              {v.segment.location} · {v.effortCount} {t("efforts")}
            </p>
            {v.myRank ? (
              <p className="text-xs font-bold text-nh-forest">
                {t("Your rank")} #{v.myRank} ·{" "}
                {v.myBestElapsedSec ? formatDuration(v.myBestElapsedSec) : ""}
              </p>
            ) : null}
          </div>
          <div className="text-right text-sm">
            <p className="nh-label !mb-0">{t("Record time")}</p>
            <p className="font-black">
              {v.bestElapsedSec ? formatDuration(v.bestElapsedSec) : "-"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

function RoutesTab() {
  const t = useT();
  const units = useUnits();
  const invalidate = useInvalidateAll();
  const { data: routes, isLoading } = useRoutes();
  if (isLoading) return <Spinner label={t("Loading routes…")} />;
  if (!routes || routes.length === 0) {
    return (
      <p className="nh-card text-sm text-nh-muted">
        {t(
          'No saved routes yet. Open one of your activities and choose "Save as route".',
        )}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {routes.map((route) => (
        <div key={route.id} className="nh-card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-black">{route.name}</p>
              <p className="text-sm text-nh-muted">
                {formatDistanceM(route.distanceM, units)} · {t("saved")}{" "}
                {formatDay(route.createdAt)}
              </p>
            </div>
            <button
              className="text-nh-muted hover:text-nh-danger"
              aria-label={t("Delete route")}
              onClick={async () => {
                if (!window.confirm(`${t("Delete route")} "${route.name}"?`))
                  return;
                await trainApi.deleteRoute(route.id);
                invalidate();
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="mt-2">
            <RouteMap points={route.points} height={110} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChallengesTab() {
  const t = useT();
  const { data, isLoading } = useChallenges();
  const invalidate = useInvalidateAll();
  if (isLoading) return <Spinner label={t("Loading challenges…")} />;
  if (!data || data.length === 0)
    return (
      <p className="nh-card text-sm text-nh-muted">
        {t("No challenges running.")}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      {data.map((v) => {
        const pct = Math.min(1, v.progressKm / v.challenge.targetKm);
        return (
          <div key={v.challenge.id} className="nh-card">
            <Link
              href={m(`/train/challenges/${v.challenge.id}`)}
              className="flex items-start justify-between gap-2"
            >
              <div>
                <p className="font-black">{v.challenge.name}</p>
                <p className="text-sm text-nh-muted">
                  {v.challenge.description}
                </p>
              </div>
              <Trophy size={20} className="shrink-0 text-nh-forest" />
            </Link>
            {v.joined ? (
              <>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-nh-raised">
                  <div
                    className="h-full rounded-full bg-nh-forest"
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs font-bold text-nh-muted">
                  {v.progressKm.toFixed(1)} / {v.challenge.targetKm} km ·{" "}
                  {v.participantCount} {t("athletes")}
                </p>
                {v.leaderboard.length > 0 ? (
                  <div className="mt-2">
                    <KmBoard rows={v.leaderboard} />
                  </div>
                ) : null}
              </>
            ) : (
              <button
                className="nh-btn-brand mt-3 !py-2 text-sm"
                onClick={async () => {
                  await trainApi.joinChallenge(v.challenge.id);
                  invalidate();
                }}
              >
                {t("Join challenge")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClubsTab() {
  const t = useT();
  const { data, isLoading } = useClubs();
  const invalidate = useInvalidateAll();
  if (isLoading) return <Spinner label={t("Loading clubs…")} />;
  if (!data || data.length === 0)
    return (
      <p className="nh-card text-sm text-nh-muted">{t("No clubs yet.")}</p>
    );
  return (
    <div className="flex flex-col gap-3">
      {data.map((v) => (
        <div key={v.club.id} className="nh-card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-black">{v.club.name}</p>
              <p className="text-sm text-nh-muted">{v.club.description}</p>
              <p className="mt-1 flex items-center gap-1 text-xs font-bold text-nh-muted">
                <Users size={12} /> {v.memberCount} {t("members")} ·{" "}
                {v.club.location}
              </p>
            </div>
            <button
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-black uppercase ${
                v.joined
                  ? "bg-nh-raised text-nh-muted"
                  : "bg-nh-forest text-white"
              }`}
              onClick={async () => {
                await trainApi.toggleClub(v.club.id);
                invalidate();
              }}
            >
              {t(v.joined ? "Leave" : "Join")}
            </button>
          </div>
          {v.joined && v.weeklyLeaderboard.length > 0 ? (
            <div className="mt-3 border-t border-nh-line pt-2">
              <p className="nh-label">{t("This week")}</p>
              <KmBoard rows={v.weeklyLeaderboard} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AthletesTab() {
  const t = useT();
  const { data, isLoading } = useSocial();
  const follow = useFollowMutation();
  if (isLoading || !data) return <Spinner label={t("Loading athletes…")} />;

  const row = ({
    memberId,
    name,
    weeklyKm,
    isFollowing,
  }: (typeof data.suggestions)[number]) => (
    <div
      key={memberId}
      className="nh-card flex items-center justify-between !py-3"
    >
      <Link
        href={m(`/train/athletes/${memberId}`)}
        className="flex items-center gap-3"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-nh-ink-soft text-xs font-black text-white">
          {initialsOf(name)}
        </div>
        <div>
          <p className="text-sm font-black">{name}</p>
          <p className="text-xs text-nh-muted">
            {weeklyKm.toFixed(1)} km {t("this week")}
          </p>
        </div>
      </Link>
      <button
        className={`flex items-center gap-1 rounded-full px-4 py-1.5 text-xs font-black uppercase ${
          isFollowing ? "bg-nh-raised text-nh-muted" : "bg-nh-forest text-white"
        }`}
        disabled={follow.isPending}
        onClick={() => follow.mutate(memberId)}
      >
        {isFollowing ? (
          <>
            <Check size={12} /> {t("Following")}
          </>
        ) : (
          t("Follow")
        )}
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {data.suggestions.length > 0 ? (
        <section>
          <p className="nh-label">{t("Suggested")}</p>
          <div className="flex flex-col gap-2">{data.suggestions.map(row)}</div>
        </section>
      ) : null}
      <section>
        <p className="nh-label">
          {t("Following")} ({data.following.length})
        </p>
        <div className="flex flex-col gap-2">{data.following.map(row)}</div>
      </section>
      <section>
        <p className="nh-label">
          {t("Followers")} ({data.followers.length})
        </p>
        <div className="flex flex-col gap-2">{data.followers.map(row)}</div>
      </section>
    </div>
  );
}
