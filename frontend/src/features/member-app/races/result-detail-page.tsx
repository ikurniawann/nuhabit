"use client";

import { ArrowLeft, BadgeCheck, Pencil, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RESULT_DIVISION_LABELS, formatSplit, splitLabel, type SplitCompare } from "@/lib/gym/hyrox-results";
import { useT, type T } from "../lib/i18n";
import { m } from "../lib/links";
import { useResult } from "../lib/queries-workout";
import { Spinner, formatDay, formatDuration } from "../ui";

/** "Run 3" goes through the dictionary; station names stay as HYROX names them. */
export function splitName(key: string, t: T): string {
  const run = key.match(/^run(\d)$/);
  return run ? t("Run {n}", { n: run[1]! }) : key === "total" ? t("Total") : splitLabel(key);
}

export function ResultDetailPage() {
  const { resultId = "" } = useParams<{ resultId: string }>();
  const router = useRouter();
  const t = useT();
  const { data, isLoading, error } = useResult(resultId);

  if (error) return <p className="nh-card text-sm text-nh-muted">{error.message}</p>;
  if (isLoading || !data) return <Spinner label={t("Loading result…")} />;
  const r = data.result;
  const prs = data.splits.filter((s) => s.is_pr);
  const total = data.splits.find((s) => s.key === "total");
  const splits = data.splits.filter((s) => s.key !== "total");

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">
            {formatDay(r.raced_at)} · {RESULT_DIVISION_LABELS[r.division]}
            {r.age_group ? ` · ${r.age_group}` : ""}
          </p>
          <p className="nh-display mt-0.5 text-2xl leading-tight">{r.race_name ?? t("HYROX simulation")}</p>
          <p className="nh-display mt-2 text-5xl tabular-nums">{formatDuration(r.total_sec)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {r.verified ? (
              <span className="nh-chip bg-nh-lime text-nh-forest">
                <BadgeCheck size={13} /> {t("Verified")}
              </span>
            ) : (
              <span className="nh-chip bg-white/15 text-white">{t("Waiting for verification")}</span>
            )}
            {prs.length ? (
              <span className="nh-chip bg-nh-lime text-nh-forest">
                <Trophy size={13} /> {prs.length === 1 ? t("1 new PR") : t("{n} new PRs", { n: prs.length })}
              </span>
            ) : null}
          </div>
          {r.total_mismatch && r.splits_total_sec !== null ? (
            <p className="mt-3 text-xs text-white/70">
              {t("Official total {official}, splits add up to {splits}.", {
                official: formatDuration(r.official_total_sec ?? r.total_sec),
                splits: formatDuration(r.splits_total_sec),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="nh-card flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-nh-muted">
          <Legend className="bg-nh-forest" label={t("You")} />
          <Legend className="bg-nh-lettuce" label={t("Your previous best")} />
          <Legend className="bg-nh-muted/40" label={t("Gym average")} />
        </div>
        {splits.map((s) => (
          <SplitBars key={s.key} split={s} name={splitName(s.key, t)} t={t} />
        ))}
        {r.roxzone_sec !== null ? (
          <p className="flex justify-between border-t border-nh-line pt-3 text-sm font-bold">
            <span>{t("Roxzone")}</span>
            <span className="tabular-nums">{formatSplit(r.roxzone_sec)}</span>
          </p>
        ) : null}
        {total ? <SplitBars split={total} name={t("Total")} t={t} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link href={m(`/races/results/${r.id}/edit`)} className="nh-btn-ghost flex items-center justify-center gap-2 text-sm">
          <Pencil size={15} /> {t("Edit")}
        </Link>
        <Link
          href={m(`/races/leaderboard${r.race_event_id ? `?race=${r.race_event_id}` : ""}`)}
          className="nh-btn-brand flex items-center justify-center gap-2 text-sm"
        >
          <Trophy size={15} /> {t("Leaderboard")}
        </Link>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-4 rounded-full ${className}`} />
      {label}
    </span>
  );
}

/** One split: the member's time with bars against their previous best and the gym average. */
function SplitBars({ split, name, t }: { split: SplitCompare; name: string; t: T }) {
  const values = [split.sec, split.previous_best_sec, split.gym_average_sec];
  const widest = Math.max(1, ...values.map((v) => v ?? 0));
  const bar = (value: number | null, className: string) =>
    value === null ? null : (
      <div className="h-1.5 rounded-full bg-nh-raised">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${(value / widest) * 100}%` }} />
      </div>
    );
  return (
    <div className="border-t border-nh-line pt-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-bold">
          {name}
          {split.is_pr ? <span className="nh-chip bg-nh-lime !px-2 !py-0 text-[10px] text-nh-forest">PR</span> : null}
        </span>
        <span className="font-black tabular-nums">{split.sec === null ? "-" : formatSplit(split.sec)}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {bar(split.sec, "bg-nh-forest")}
        {bar(split.previous_best_sec, "bg-nh-lettuce")}
        {bar(split.gym_average_sec, "bg-nh-muted/40")}
      </div>
      {split.previous_best_sec !== null || split.gym_average_sec !== null ? (
        <p className="mt-1 text-[11px] font-bold text-nh-muted">
          {split.previous_best_sec !== null ? `${t("Best")} ${formatSplit(split.previous_best_sec)}` : ""}
          {split.previous_best_sec !== null && split.gym_average_sec !== null ? " · " : ""}
          {split.gym_average_sec !== null ? `${t("Gym")} ${formatSplit(split.gym_average_sec)}` : ""}
        </p>
      ) : null}
    </div>
  );
}
