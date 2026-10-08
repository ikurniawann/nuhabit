"use client";

import { useState } from "react";
import Link from "next/link";
import { weeklyGoalProgress } from "@/lib/gym/athlete";
import { Plus } from "lucide-react";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import {
  trainApi,
  useAthleteStats,
  useInvalidateAll,
  useMyActivities,
  useUnits,
} from "../lib/queries-train";
import { Spinner, formatDistanceM, formatDuration, formatPace } from "../ui";
import { AddGearSheet } from "../profile/gear-page";
import { ActivityCard } from "./feed-page";
import { TrainTabs } from "./train-tabs";

/** Black stat card shared by You, athlete profile and heatmap. */
export function TotalsCard({
  cells,
}: {
  cells: { label: string; value: string | number }[];
}) {
  return (
    <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
      <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
      <div className="relative grid grid-cols-3 gap-3 text-center text-sm">
        {cells.map((c) => (
          <div key={c.label}>
            <p className="text-[10px] font-bold tracking-[0.18em] text-white/50 uppercase">
              {c.label}
            </p>
            <p className="nh-display mt-1 text-3xl">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const R = 34;
const CIRC = 2 * Math.PI * R;

export function YouPage() {
  const t = useT();
  const units = useUnits();
  const invalidate = useInvalidateAll();
  const { data: stats, isLoading, error } = useAthleteStats();
  const { data: mine } = useMyActivities();
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);

  if (error)
    return <p className="nh-card text-sm text-nh-danger">{error.message}</p>;
  if (isLoading || !stats) return <Spinner label={t("Loading your stats…")} />;

  const goalPct = weeklyGoalProgress(stats.goal.targetKm, stats.goal.currentKm);
  const maxWeekKm = Math.max(...stats.weekly.map((w) => w.distanceKm), 1);

  const saveGoal = async () => {
    const value = goalDraft === "" ? null : Number(goalDraft);
    await trainApi.updateSettings({
      weeklyGoalKm: value && value > 0 ? value : null,
    });
    setGoalDraft(null);
    invalidate();
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("You")}</h1>
      <TrainTabs />

      <div className="nh-card flex items-center gap-5">
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
          <circle
            cx="44"
            cy="44"
            r={R}
            fill="none"
            stroke="var(--color-nh-line)"
            strokeWidth="8"
          />
          <circle
            cx="44"
            cy="44"
            r={R}
            fill="none"
            stroke="var(--color-nh-forest)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - goalPct)}
            transform="rotate(-90 44 44)"
          />
          <text
            x="44"
            y="49"
            textAnchor="middle"
            fontSize="16"
            fontWeight="800"
            fill="#1c261b"
          >
            {Math.round(goalPct * 100)}%
          </text>
        </svg>
        <div className="min-w-0 flex-1">
          <p className="nh-label !mb-0">{t("This week")}</p>
          <p className="nh-display text-3xl">
            {stats.thisWeekKm.toFixed(1)} km
          </p>
          {goalDraft === null ? (
            <button
              className="text-sm font-bold text-nh-forest"
              onClick={() => setGoalDraft(String(stats.goal.targetKm ?? ""))}
            >
              {stats.goal.targetKm
                ? `${t("Goal")}: ${stats.goal.targetKm} km · ${t("edit")}`
                : t("Set a weekly goal")}
            </button>
          ) : (
            <div className="mt-1 flex gap-2">
              <input
                className="nh-input !w-24 !py-1.5"
                value={goalDraft}
                inputMode="decimal"
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder="km"
              />
              <button
                className="nh-btn-brand !px-3 !py-1.5 text-xs"
                onClick={() => void saveGoal()}
              >
                {t("Save")}
              </button>
            </div>
          )}
        </div>
        <div className="text-right text-xs text-nh-muted">
          <p>
            <span className="font-black text-nh-ink">
              {stats.followerCount}
            </span>{" "}
            {t("followers")}
          </p>
          <p>
            <span className="font-black text-nh-ink">
              {stats.followingCount}
            </span>{" "}
            {t("following")}
          </p>
        </div>
      </div>

      <Link
        href={m("/train/heatmap")}
        className="nh-card flex items-center justify-between !py-3 text-sm font-bold"
      >
        {t("Personal heatmap")}
        <span className="text-nh-forest">{t("View →")}</span>
      </Link>

      <div className="nh-card">
        <p className="nh-label">{t("Last 8 weeks")}</p>
        <div className="flex h-28 gap-1.5">
          {stats.weekly.map((w) => (
            <div
              key={w.weekStart}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className="w-full rounded-t bg-nh-forest"
                style={{
                  height: `${Math.max(4, (w.distanceKm / maxWeekKm) * 85)}%`,
                  opacity: w.distanceKm ? 1 : 0.2,
                }}
                title={`${w.distanceKm} km`}
              />
              <span className="text-[9px] font-bold text-nh-muted">
                {new Date(w.weekStart).getDate()}/
                {new Date(w.weekStart).getMonth() + 1}
              </span>
            </div>
          ))}
        </div>
      </div>

      <TotalsCard
        cells={[
          { label: t("Activities"), value: stats.totals.activities },
          {
            label: t("Distance"),
            value: `${stats.totals.distanceKm.toFixed(0)} km`,
          },
          { label: t("Time"), value: formatDuration(stats.totals.movingSec) },
        ]}
      />

      <div className="nh-card text-sm">
        <p className="nh-label">{t("Personal records (runs)")}</p>
        <div className="grid grid-cols-2 gap-y-2">
          <span className="text-nh-muted">{t("Best 1k")}</span>
          <span className="text-right font-black">
            {formatPace(stats.prs.best1kPaceSec, units)}
          </span>
          <span className="text-nh-muted">{t("Best 5k (est.)")}</span>
          <span className="text-right font-black">
            {stats.prs.best5kSec ? formatDuration(stats.prs.best5kSec) : "-"}
          </span>
          <span className="text-nh-muted">{t("Best 10k (est.)")}</span>
          <span className="text-right font-black">
            {stats.prs.best10kSec ? formatDuration(stats.prs.best10kSec) : "-"}
          </span>
          <span className="text-nh-muted">{t("Longest")}</span>
          <span className="text-right font-black">
            {formatDistanceM(stats.prs.longestDistanceM, units)}
          </span>
        </div>
      </div>

      <div className="nh-card text-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="nh-label !mb-0">{t("Gear")}</p>
          <button
            className="flex items-center gap-1 text-sm font-bold text-nh-forest"
            onClick={() => setGearOpen(true)}
          >
            <Plus size={14} /> {t("Add")}
          </button>
        </div>
        {stats.gear.length === 0 ? (
          <p className="text-nh-muted">
            {t("Track shoe and bike mileage here.")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {stats.gear.map((g) => (
              <div
                key={g.id}
                className={`flex items-center justify-between ${g.retired ? "opacity-50" : ""}`}
              >
                <div>
                  <p className="font-bold">{g.name}</p>
                  <p className="text-xs text-nh-muted">
                    {t(g.kind === "SHOES" ? "Shoes" : "Bike")}
                    {g.retired ? ` · ${t("retired")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-black">
                    {formatDistanceM(g.distanceM, units)}
                  </span>
                  {!g.retired ? (
                    <button
                      className="text-xs font-bold text-nh-muted"
                      onClick={async () => {
                        await trainApi.updateGear(g.id, {
                          name: g.name,
                          kind: g.kind,
                          retired: true,
                        });
                        invalidate();
                      }}
                    >
                      {t("Retire")}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <section>
        <h2 className="nh-display mb-2 text-xl">{t("My activities")}</h2>
        <div className="flex flex-col gap-3">
          {(mine ?? []).map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
          {(mine ?? []).length === 0 ? (
            <p className="nh-card text-sm text-nh-muted">
              {t("Nothing yet -")}{" "}
              <Link
                href={m("/train/record")}
                className="font-bold text-nh-forest"
              >
                {t("record your first activity")}
              </Link>
              .
            </p>
          ) : null}
        </div>
      </section>

      {gearOpen ? (
        <AddGearSheet
          onClose={() => setGearOpen(false)}
          onDone={() => {
            setGearOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
