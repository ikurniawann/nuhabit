"use client";

import { Trophy } from "lucide-react";
import { useState } from "react";
import { challengeMetricText, challengeRewardText } from "@/lib/member-app/loyalty";
import { BottomSheet } from "../components/bottom-sheet";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { joinCrmChallenge, loyaltyKeys, useCrmChallenges, useRefresh, type CrmChallenge } from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDay } from "../ui";
import { Notice, PageTitle, ProgressBar, SectionHeader } from "./loyalty-ui";

/** Challenge CRM (kunjungan / belanja): capai target dalam periode, hadiah XP/ARK masuk otomatis. */
export function ChallengesPage() {
  const t = useT();
  const { data, isLoading, error } = useCrmChallenges();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.find((c) => c.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Hit the target within the challenge period and the reward lands on its own.")}>
        {t("Challenges")}
      </PageTitle>
      {isLoading ? <Spinner label={t("Loading challenges…")} /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {data && data.length === 0 ? (
        <EmptyState title={t("No challenges running")} hint={t("Watch this space for the next one.")} />
      ) : null}
      {data?.map((c) => {
        const reward = challengeRewardText(t, c);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenId(c.id)}
            className="nh-card block w-full text-left active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
                  {c.phase === "upcoming"
                    ? t("Starts {date}", { date: formatDay(c.starts_at) })
                    : t("Until {date}", { date: formatDay(c.ends_at) })}
                </p>
                <p className="nh-display mt-1 text-xl leading-tight">{c.title}</p>
              </div>
              {c.rewarded_at ? (
                <span className="nh-chip shrink-0 bg-nh-lime text-nh-ink">{t("Completed")}</span>
              ) : c.joined ? (
                <span className="nh-chip shrink-0 bg-nh-forest/10 text-nh-forest">{t("Joined")}</span>
              ) : null}
            </div>
            {c.progress ? (
              <div className="mt-3">
                <ProgressBar pct={c.progress.pct} />
                <p className="mt-2 text-xs text-nh-muted">
                  {t("{value} of {target}", {
                    value: challengeMetricText(t, c.metric, c.progress.value),
                    target: challengeMetricText(t, c.metric, c.target),
                  })}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-nh-muted">
                {t("Target {target}", { target: challengeMetricText(t, c.metric, c.target) })}
                {reward ? ` · ${t("reward {reward}", { reward })}` : ""}
              </p>
            )}
          </button>
        );
      })}
      {open ? <ChallengeSheet challenge={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function ChallengeSheet({ challenge: c, onClose }: { challenge: CrmChallenge; onClose: () => void }) {
  const t = useT();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reward = challengeRewardText(t, c);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      await joinCrmChallenge(c.id);
      await refresh(loyaltyKeys.challenges);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Request failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet kicker={t("Until {date}", { date: formatDay(c.ends_at) })} title={c.title} onClose={onClose}>
      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 text-white">
        <div className="pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full bg-nh-lime/20 blur-3xl" />
        <p className="relative text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">{t("Target")}</p>
        <p className="nh-display relative mt-1 text-3xl">{challengeMetricText(t, c.metric, c.target)}</p>
        {reward ? (
          <p className="relative mt-2 text-xs font-semibold text-nh-lime">{t("Reward {reward}", { reward })}</p>
        ) : null}
        {c.progress ? (
          <div className="relative mt-4">
            <ProgressBar pct={c.progress.pct} />
            <p className="mt-2 text-xs text-white/60">
              {t("{value} logged", { value: challengeMetricText(t, c.metric, c.progress.value) })}
              {c.my_rank ? ` · ${t("rank #{rank} of {total}", { rank: c.my_rank, total: c.participant_count })}` : ""}
            </p>
          </div>
        ) : null}
      </div>
      {c.description ? <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{c.description}</p> : null}

      {c.leaderboard.length > 0 ? (
        <section className="mt-5">
          <SectionHeader label={t("Leaderboard")} />
          <div className="nh-card divide-y divide-nh-line !py-1">
            {c.leaderboard.map((row) => (
              <div
                key={row.rank}
                className={`flex items-center gap-3 py-2.5 text-sm ${row.is_me ? "font-extrabold" : ""}`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                    row.rank === 1 ? "nh-surface-brand text-nh-ink" : "bg-nh-raised"
                  }`}
                >
                  {row.rank === 1 ? <Trophy size={13} /> : row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {row.name}
                  {row.is_me ? ` (${t("You")})` : ""}
                </span>
                <span className="shrink-0 tabular-nums">{challengeMetricText(t, c.metric, row.value)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
      {!c.joined && c.phase !== "ended" ? (
        <button type="button" className="nh-btn-brand mt-5 w-full" disabled={busy} onClick={() => void join()}>
          {busy ? t("Processing…") : t("Join challenge")}
        </button>
      ) : null}
    </BottomSheet>
  );
}
