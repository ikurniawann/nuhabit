"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trophy } from "lucide-react";
import { useT } from "../lib/i18n";
import {
  trainApi,
  useChallenges,
  useInvalidateAll,
} from "../lib/queries-train";
import { Spinner, formatDay } from "../ui";

export function ChallengeDetailPage() {
  const { challengeId = "" } = useParams<{ challengeId: string }>();
  const router = useRouter();
  const t = useT();
  const invalidate = useInvalidateAll();
  const { data: challenges, isLoading } = useChallenges();

  if (isLoading || !challenges)
    return <Spinner label={t("Loading challenge…")} />;
  const view = challenges.find((c) => c.challenge.id === challengeId);
  if (!view)
    return (
      <p className="nh-card text-sm text-nh-muted">
        {t("Challenge not found.")}
      </p>
    );

  const { challenge: c } = view;
  const pct = Math.min(100, (view.progressKm / c.targetKm) * 100);

  const join = async () => {
    await trainApi.joinChallenge(c.id);
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

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
            <Trophy size={13} className="text-nh-lime" /> {t("Challenge")} ·{" "}
            {formatDay(c.startsAt)} – {formatDay(c.endsAt)}
          </p>
          <p className="nh-display mt-1 text-3xl leading-tight">{c.name}</p>
          <p className="mt-1.5 text-sm text-white/60">{c.description}</p>
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="nh-display text-2xl">
                {view.progressKm.toFixed(1)}
                <span className="text-sm font-bold text-white/50">
                  {" "}
                  / {c.targetKm} km
                </span>
              </span>
              <span className="font-bold text-white/60">
                {Math.round(pct)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-nh-forest to-[#ff7a45]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {!view.joined ? (
        <button className="nh-btn-brand" onClick={() => void join()}>
          {t("Join challenge")}
        </button>
      ) : (
        <p className="nh-chip self-start bg-nh-ok/10 text-nh-ok">
          {t("You're in -")} {view.participantCount} {t("athletes joined")}
        </p>
      )}

      <section>
        <p className="mb-2 px-1 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
          {t("Leaderboard")}
        </p>
        <div className="nh-card divide-y divide-nh-line !py-1">
          {view.leaderboard.map((row, i) => (
            <div
              key={`${row.memberName}-${i}`}
              className="flex items-center gap-3 py-3"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  i === 0
                    ? "bg-nh-forest text-white"
                    : "bg-nh-raised text-nh-muted"
                }`}
              >
                {i + 1}
              </span>
              <p
                className={`min-w-0 flex-1 truncate text-sm ${row.isMe ? "font-extrabold text-nh-forest" : "font-bold"}`}
              >
                {row.memberName}
                {row.isMe ? ` (${t("you")})` : ""}
              </p>
              <span className="nh-display text-lg">{row.km.toFixed(1)} km</span>
            </div>
          ))}
          {view.leaderboard.length === 0 ? (
            <p className="py-3 text-sm text-nh-muted">
              {t("Nobody has logged kilometres yet.")}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
