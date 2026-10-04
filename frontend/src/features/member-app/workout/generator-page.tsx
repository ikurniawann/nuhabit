"use client";

import { CirclePlay, Dumbbell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Division, WorkoutType } from "@/lib/gym/hyrox";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { api, useExerciseLibrary, useWorkoutSessions } from "../lib/queries-workout";
import { Spinner, StatusBadge, formatDayTime, formatDuration } from "../ui";

const TYPE_INFO: { id: WorkoutType; label: string; hint: string }[] = [
  { id: "FULL_SIMULATION", label: "Full Simulation", hint: "8× 1 km run + all 8 stations, race order" },
  { id: "COVERAGE", label: "Coverage", hint: "600 m runs + your chosen stations" },
  { id: "QUICK", label: "Quick", hint: "400 m runs + 4 stations at half volume" },
  { id: "PRACTICE", label: "Practice", hint: "3 rounds on a single station" },
];
export const DIVISIONS: { id: Division; label: string }[] = [
  { id: "MEN_OPEN", label: "Men Open" },
  { id: "MEN_PRO", label: "Men Pro" },
  { id: "WOMEN_OPEN", label: "Women Open" },
  { id: "WOMEN_PRO", label: "Women Pro" },
];

export function WorkoutGeneratorPage() {
  const router = useRouter();
  const t = useT();
  const { data: library } = useExerciseLibrary();
  const { data: sessions, isLoading: historyLoading } = useWorkoutSessions();

  const [type, setType] = useState<WorkoutType>("FULL_SIMULATION");
  const [division, setDivision] = useState<Division>("MEN_OPEN");
  const [stationOrders, setStationOrders] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stations = (library?.exercises ?? []).filter((e) => e.hyroxStationOrder !== null);
  const needsStations = type === "COVERAGE" || type === "PRACTICE";

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const workout = await api.workout.generate({
        type,
        division,
        stationOrders: needsStations ? stationOrders : [],
        excludedExerciseIds: excluded,
      });
      router.push(m(`/workout/preview/${workout.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Generation failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("Workout generator")}</h1>

      <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
            <Dumbbell size={22} className="text-nh-lime" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="nh-display text-xl leading-tight">{t("Build your HYROX day.")}</p>
            <p className="mt-0.5 text-sm text-white/60">{t("Race order, division loads, smart substitutes.")}</p>
          </div>
        </div>
        <Link href={m("/train/tutorials")} className="nh-chip relative mt-4 bg-white/10 text-white">
          <CirclePlay size={13} /> {t("Technique videos →")}
        </Link>
      </div>

      <div>
        <p className="nh-label">{t("Workout type")}</p>
        <div className="flex flex-col gap-2">
          {TYPE_INFO.map((info) => (
            <button
              key={info.id}
              onClick={() => setType(info.id)}
              className={`nh-card flex items-center justify-between text-left !py-3 ${
                type === info.id ? "!border-nh-forest" : ""
              }`}
            >
              <div>
                <p className="font-black">{t(info.label)}</p>
                <p className="text-xs text-nh-muted">{t(info.hint)}</p>
              </div>
              {type === info.id ? <span className="text-nh-forest">●</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="nh-label">{t("Division")}</p>
        <div className="grid grid-cols-2 gap-2">
          {DIVISIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDivision(d.id)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-black uppercase ${
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

      {needsStations ? (
        <div>
          <p className="nh-label">
            {t("Stations")} ({type === "PRACTICE" ? t("pick one") : t("pick any - empty = random 4")})
          </p>
          <div className="grid grid-cols-2 gap-2">
            {stations.map((s) => {
              const order = s.hyroxStationOrder!;
              const selected = stationOrders.includes(order);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    setStationOrders((prev) =>
                      type === "PRACTICE" ? [order] : selected ? prev.filter((o) => o !== order) : [...prev, order]
                    )
                  }
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-bold ${
                    selected ? "border-nh-forest bg-nh-forest/10 text-nh-forest" : "border-nh-line bg-nh-cream text-nh-muted"
                  }`}
                >
                  {order}. {s.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <p className="nh-label">{t("Exclude exercises (no equipment? we substitute)")}</p>
        <div className="flex flex-wrap gap-2">
          {stations.map((s) => {
            const isExcluded = excluded.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() =>
                  setExcluded((prev) => (isExcluded ? prev.filter((id) => id !== s.id) : [...prev, s.id]))
                }
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  isExcluded ? "bg-nh-danger/15 text-nh-danger line-through" : "bg-nh-cream text-nh-muted"
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      <button
        className="nh-btn-brand"
        disabled={busy || (type === "PRACTICE" && stationOrders.length === 0)}
        onClick={() => void generate()}
      >
        {t("Generate")}
      </button>

      <section>
        <h2 className="nh-display mb-2 text-xl">{t("History")}</h2>
        {historyLoading ? (
          <Spinner label={t("Loading history…")} />
        ) : !sessions || sessions.length === 0 ? (
          <p className="nh-card text-sm text-nh-muted">{t("No workouts yet.")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((item) => (
              <div key={item.session.id} className="nh-card flex items-center justify-between !py-3">
                <div>
                  <p className="text-sm font-black">
                    {t(TYPE_INFO.find((x) => x.id === item.workoutType)?.label ?? item.workoutType)}
                  </p>
                  <p className="text-xs text-nh-muted">
                    {formatDayTime(item.session.createdAt)} · {item.division.replaceAll("_", " ").toLowerCase()}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={item.session.status} />
                  <p className="mt-0.5 text-xs font-bold text-nh-muted">
                    {formatDuration(item.activeSec)} · {item.completionPct}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
