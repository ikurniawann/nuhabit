"use client";

import { ArrowLeft, BadgeCheck, Crown, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AGE_GROUPS,
  HYROX_STATIONS,
  RESULT_DIVISIONS,
  RESULT_DIVISION_LABELS,
  formatSplit,
  type AgeGroup,
  type LeaderboardQuery,
  type ResultDivision,
  type ResultSource,
} from "@/lib/gym/hyrox-results";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useLeaderboard, useRaces } from "../lib/queries-workout";
import { Spinner, formatDay } from "../ui";

const chipClass = (active: boolean) =>
  `whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold ${
    active ? "bg-nh-ink text-white" : "bg-nh-cream text-nh-muted"
  }`;

/** HYROX leaderboards; ?race= opens one race's board. useSearchParams needs Suspense. */
export function LeaderboardPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Leaderboard />
    </Suspense>
  );
}

function Leaderboard() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [raceId, setRaceId] = useState(searchParams.get("race") ?? "");
  const [source, setSource] = useState<ResultSource>("race");
  const [division, setDivision] = useState<ResultDivision | "">("");
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">("");
  const [year, setYear] = useState(0);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [station, setStation] = useState(0);

  const finished = useRaces({ scope: "results" });
  const upcoming = useRaces({ scope: "upcoming" });
  const [now] = useState(() => Date.now());
  const races = [...(upcoming.data ?? []), ...(finished.data ?? [])].filter(
    (v) => new Date(v.event.startsAt).getTime() <= now
  );

  const query: LeaderboardQuery = {
    raceId: source === "race" ? raceId || undefined : undefined,
    source,
    division: division || undefined,
    ageGroup: ageGroup || undefined,
    year: year || undefined,
    includeUnverified,
    station: station || undefined,
  };
  const { data, isLoading, error } = useLeaderboard(query);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Leaderboard")}</h1>

      <div className="flex rounded-xl bg-nh-cream p-1">
        {(["race", "simulation"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={`flex-1 rounded-lg py-2 text-sm font-black uppercase tracking-wide ${
              source === s ? "bg-nh-ink-soft text-white" : "text-nh-muted"
            }`}
          >
            {s === "race" ? t("Races") : t("Simulations")}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setStation(0)} className={chipClass(station === 0)}>
          {t("Total")}
        </button>
        {HYROX_STATIONS.map((s, i) => (
          <button key={s.name} onClick={() => setStation(i + 1)} className={chipClass(station === i + 1)}>
            {s.name}
          </button>
        ))}
      </div>

      <div className="nh-card grid grid-cols-2 gap-2 !p-3">
        {source === "race" ? (
          <select className="nh-input col-span-2" value={raceId} onChange={(e) => setRaceId(e.target.value)} aria-label={t("Race")}>
            <option value="">{t("All races")}</option>
            {races.map((v) => (
              <option key={v.event.id} value={v.event.id}>
                {v.event.name} · {formatDay(v.event.startsAt)}
              </option>
            ))}
          </select>
        ) : null}
        <select
          className="nh-input"
          value={division}
          onChange={(e) => setDivision(e.target.value as ResultDivision | "")}
          aria-label={t("Division")}
        >
          <option value="">{t("All divisions")}</option>
          {RESULT_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {RESULT_DIVISION_LABELS[d]}
            </option>
          ))}
        </select>
        <select
          className="nh-input"
          value={ageGroup}
          onChange={(e) => setAgeGroup(e.target.value as AgeGroup | "")}
          aria-label={t("Age group")}
        >
          <option value="">{t("All ages")}</option>
          {AGE_GROUPS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className="nh-input"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label={t("Year")}
        >
          <option value={0}>{t("All time")}</option>
          {(data?.years ?? []).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <label className="flex items-center justify-between gap-2 px-1 text-xs font-bold text-nh-muted">
          {t("Include unverified")}
          <input
            type="checkbox"
            checked={includeUnverified}
            onChange={(e) => setIncludeUnverified(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[var(--color-nh-forest)]"
          />
        </label>
      </div>

      {data?.hidden ? (
        <p className="nh-card flex items-start gap-2 text-sm text-nh-muted">
          <EyeOff size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("You are hidden from other members' leaderboards.")}{" "}
            <Link href={m("/profile/settings")} className="font-bold text-nh-forest underline">
              {t("Change in Settings")}
            </Link>
          </span>
        </p>
      ) : null}

      {error ? (
        <p className="nh-card text-sm text-nh-muted">{error.message}</p>
      ) : isLoading || !data ? (
        <Spinner label={t("Loading leaderboard…")} />
      ) : (
        <div className="nh-card !p-0">
          {data.my_rank ? (
            <p className="px-4 pt-4 text-sm font-black text-nh-forest">
              {t("Your rank")}: #{data.my_rank}
            </p>
          ) : null}
          <div className="flex flex-col pt-2">
            {data.rows.map((row) => (
              <div
                key={row.result_id}
                className={`flex items-center justify-between gap-3 border-t border-nh-line px-4 py-2.5 text-sm first:border-0 ${
                  row.is_me ? "bg-nh-forest/5 text-nh-forest" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 font-black">{row.rank}</span>
                  {row.rank === 1 ? <Crown size={14} className="shrink-0 text-nh-forest" /> : null}
                  <div className="min-w-0">
                    <p className="truncate font-bold">
                      {row.name}
                      {row.is_me ? ` (${t("You")})` : ""}
                    </p>
                    <p className="truncate text-xs text-nh-muted">
                      {RESULT_DIVISION_LABELS[row.division]}
                      {row.age_group ? ` · ${row.age_group}` : ""}
                      {row.race_name ? ` · ${row.race_name}` : ` · ${formatDay(row.raced_at)}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {includeUnverified && row.verified ? (
                    <BadgeCheck size={14} className="text-nh-forest" aria-label={t("Verified")} />
                  ) : null}
                  <span className="font-black tabular-nums">{formatSplit(row.value_sec)}</span>
                </div>
              </div>
            ))}
            {data.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-nh-muted">
                {includeUnverified
                  ? t("No results here yet.")
                  : t("No verified results here yet. Include unverified to see everything logged.")}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
