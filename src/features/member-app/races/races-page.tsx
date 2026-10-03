"use client";

import { Flag, MapPin, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Division } from "@/lib/gym/hyrox";
import { parseHms, type MyRaceView, type RaceEventView } from "@/lib/member-app/workout";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { api, useInvalidateAll, useMyRaces, useRaces } from "../lib/queries-workout";
import { Spinner, StatusBadge, formatDay, formatDuration } from "../ui";
import { DIVISIONS } from "../workout/generator-page";

const TABS = ["Upcoming", "Results", "My Races"] as const;
type Tab = (typeof TABS)[number];
const REGIONS = ["", "ASIA", "EUROPE", "AMERICAS", "OCEANIA"];

export function RacesPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("Upcoming");
  const [region, setRegion] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Flag size={22} className="text-nh-forest" />
        <h1 className="nh-display text-3xl">{t("Races")}</h1>
      </div>
      <div className="flex rounded-xl bg-nh-cream p-1">
        {TABS.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={`flex-1 rounded-lg py-2 text-sm font-black uppercase tracking-wide ${
              tab === item ? "bg-nh-ink-soft text-white" : "text-nh-muted"
            }`}
          >
            {t(item)}
          </button>
        ))}
      </div>
      {tab !== "My Races" ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {REGIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-bold ${
                region === r ? "bg-nh-ink text-white" : "bg-nh-cream text-nh-muted"
              }`}
            >
              {r === "" ? t("All regions") : t(r[0] + r.slice(1).toLowerCase())}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "My Races" ? (
        <MyRacesTab />
      ) : (
        <DiscoveryTab scope={tab === "Results" ? "results" : "upcoming"} region={region} />
      )}
    </div>
  );
}

function DiscoveryTab({ scope, region }: { scope: "upcoming" | "results"; region: string }) {
  const t = useT();
  const { data, isLoading } = useRaces({ scope, region: region || undefined });
  const [registerTarget, setRegisterTarget] = useState<RaceEventView | null>(null);
  const invalidate = useInvalidateAll();

  if (isLoading) return <Spinner label={t("Finding races…")} />;

  return (
    <div className="flex flex-col gap-3">
      {(data ?? []).map((v) => (
        <div key={v.event.id} className="nh-card overflow-hidden !p-0">
          <div className="relative h-40 w-full">
            {v.event.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.event.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="nh-surface-brand h-full w-full" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute right-3 top-3">
              <StatusBadge status={v.event.status} />
            </div>
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] opacity-90">{formatDay(v.event.startsAt)}</p>
              <Link href={m(`/races/${v.event.id}`)} className="nh-display block text-2xl leading-tight">
                {v.event.name}
              </Link>
              <p className="flex items-center gap-1 text-xs font-bold opacity-90">
                <MapPin size={12} />
                {v.event.venue}, {v.event.city}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 p-3.5">
            <p className="text-xs font-bold text-nh-muted">
              {v.participantCount} {t("from this studio")}
            </p>
            {scope === "upcoming" ? (
              v.joined ? (
                <p className="text-sm font-extrabold text-nh-ok">{t("On your race list")}</p>
              ) : v.event.status === "REGISTRATION_OPEN" || v.event.status === "ANNOUNCED" ? (
                <button className="nh-btn-brand !px-4 !py-2 text-sm" onClick={() => setRegisterTarget(v)}>
                  {t("Add to my races")}
                </button>
              ) : null
            ) : null}
          </div>
        </div>
      ))}
      {(data ?? []).length === 0 ? <p className="nh-card text-sm text-nh-muted">{t("No races here yet.")}</p> : null}
      {registerTarget ? (
        <RegisterSheet
          view={registerTarget}
          onClose={() => setRegisterTarget(null)}
          onDone={() => {
            setRegisterTarget(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

export function RegisterSheet({
  view,
  onClose,
  onDone,
}: {
  view: RaceEventView;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [division, setDivision] = useState<Division>("MEN_OPEN");
  const [goal, setGoal] = useState("01:30:00");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.races.register(view.event.id, { division, goalSec: parseHms(goal) });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Registration failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-nh-cream p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="nh-display mb-1 text-xl">{view.event.name}</h2>
        <p className="mb-4 text-sm text-nh-muted">
          {t("Adds the race to My Races for goal setting and training. Official registration happens on hyrox.com.")}
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <p className="nh-label">{t("Division")}</p>
            <div className="grid grid-cols-2 gap-2">
              {DIVISIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDivision(d.id)}
                  className={`rounded-xl border px-3 py-2 text-sm font-black uppercase ${
                    division === d.id
                      ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
                      : "border-nh-line bg-nh-cream text-nh-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="nh-label">{t("Goal time (hh:mm:ss, optional)")}</label>
            <input className="nh-input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="01:30:00" />
          </div>
          {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
          <button className="nh-btn-brand" disabled={busy} onClick={() => void submit()}>
            {t("Add to my races")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MyRacesTab() {
  const router = useRouter();
  const t = useT();
  const { data, isLoading } = useMyRaces();
  const invalidate = useInvalidateAll();
  const [resultTarget, setResultTarget] = useState<MyRaceView | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Spinner label={t("Loading your races…")} />;
  if (!data || data.length === 0) {
    return <p className="nh-card text-sm text-nh-muted">{t("Nothing yet - add a race from the Upcoming tab.")}</p>;
  }

  const runSimulation = async (race: MyRaceView) => {
    setBusy(true);
    try {
      const workout = await api.workout.generate({
        type: "FULL_SIMULATION",
        division: race.userRace.division,
        stationOrders: [],
        excludedExerciseIds: [],
      });
      router.push(m(`/workout/preview/${workout.id}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {data.map((race) => (
        <div key={race.userRace.id} className="nh-card overflow-hidden !p-0">
          <div className="relative h-28 w-full">
            {race.event.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={race.event.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="nh-surface-brand h-full w-full" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <div className="absolute right-3 top-3">
              <StatusBadge status={race.userRace.status} />
            </div>
            <div className="absolute inset-x-0 bottom-0 px-4 pb-2.5 text-white">
              <p className="nh-display text-2xl leading-tight">{race.event.name}</p>
              <p className="text-xs font-bold opacity-90">
                {formatDay(race.event.startsAt)} · {race.userRace.division.replaceAll("_", " ").toLowerCase()}
              </p>
            </div>
          </div>
          <div className="p-4 pt-1">
            {race.userRace.status === "TRAINING" ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-nh-raised p-2">
                    <p className="nh-label !mb-0">{t("Days out")}</p>
                    <p className="nh-display text-xl">{Math.max(0, race.daysToRace)}</p>
                  </div>
                  <div className="rounded-xl bg-nh-raised p-2">
                    <p className="nh-label !mb-0">{t("Goal")}</p>
                    <p className="nh-display text-xl">{race.userRace.goalSec ? formatDuration(race.userRace.goalSec) : "-"}</p>
                  </div>
                  <div className="rounded-xl bg-nh-raised p-2">
                    <p className="nh-label !mb-0">{t("Prediction")}</p>
                    <p className="nh-display text-xl">{race.predictionSec ? formatDuration(race.predictionSec) : "-"}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs font-bold text-nh-muted">
                    <span>{t("Race readiness")}</span>
                    <span>{race.readinessScore}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-nh-raised">
                    <div className="h-full rounded-full bg-nh-forest" style={{ width: `${race.readinessScore}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-nh-muted">
                    {race.simulationCount}{" "}
                    {race.simulationCount === 1 ? t("full simulation completed") : t("full simulations completed")}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="nh-btn-brand !py-2 text-sm" disabled={busy} onClick={() => void runSimulation(race)}>
                    {t("Run simulation")}
                  </button>
                  <button className="nh-btn-ghost !py-2 text-sm" onClick={() => setResultTarget(race)}>
                    {t("Enter result")}
                  </button>
                </div>
              </>
            ) : race.analysis ? (
              <div className="mt-3 rounded-xl bg-nh-raised p-3 text-sm">
                <p className="flex items-center gap-1.5 font-black">
                  <Trophy size={15} className="text-nh-forest" />
                  {t("Finished in")} {formatDuration(race.userRace.resultSec!)}
                </p>
                <p className={`mt-1 font-bold ${race.analysis.achievedGoal ? "text-nh-ok" : "text-nh-warn"}`}>
                  {race.analysis.vsGoalSec !== null
                    ? race.analysis.achievedGoal
                      ? `${t("Goal beaten by")} ${formatDuration(Math.abs(race.analysis.vsGoalSec))}`
                      : `${formatDuration(race.analysis.vsGoalSec)} ${t("over goal")}`
                    : t("No goal was set")}
                </p>
                {race.analysis.vsPredictionSec !== null ? (
                  <p className="text-nh-muted">
                    {race.analysis.vsPredictionSec <= 0
                      ? `${formatDuration(Math.abs(race.analysis.vsPredictionSec))} ${t("faster than predicted")}`
                      : `${formatDuration(race.analysis.vsPredictionSec)} ${t("slower than predicted")}`}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {resultTarget ? (
        <ResultSheet
          race={resultTarget}
          onClose={() => setResultTarget(null)}
          onDone={() => {
            setResultTarget(null);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

function ResultSheet({ race, onClose, onDone }: { race: MyRaceView; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [result, setResult] = useState("01:32:00");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const resultSec = parseHms(result);
    if (resultSec === null) {
      setError(t("Use hh:mm:ss."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.races.update(race.userRace.id, { resultSec });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not save result."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-nh-cream p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="nh-display mb-1 text-xl">{t("Race result")}</h2>
        <p className="mb-3 text-sm text-nh-muted">{race.event.name}</p>
        <label className="nh-label">{t("Finish time (hh:mm:ss)")}</label>
        <input className="nh-input" value={result} onChange={(e) => setResult(e.target.value)} />
        {error ? <p className="mt-2 text-sm font-bold text-nh-danger">{error}</p> : null}
        <button className="nh-btn-brand mt-3 w-full" disabled={busy} onClick={() => void submit()}>
          {t("Save result")}
        </button>
      </div>
    </div>
  );
}
