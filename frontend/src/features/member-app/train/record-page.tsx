"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, Timer, Volume2 } from "lucide-react";
import type { Division } from "@/lib/gym/hyrox";
import { GeoMap } from "../components/geo-map";
import { LocationGate } from "../components/location-gate";
import { ApiError } from "../lib/api";
import { acceptGpsFix, type AcceptedFix } from "../lib/gps-track";
import { useLocationPermission } from "../lib/geolocation";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import {
  useAthleteStats,
  useInvalidateAll,
  useUnits,
  type ActivityType,
  type TrackPoint,
} from "../lib/queries-train";
import { api as workoutApi } from "../lib/queries-workout";
import { ExercisePicker } from "./record/exercise-picker";
import { HyroxSimCard } from "./record/hyrox-sim-card";
import { LapBar } from "./record/lap-bar";
import { GpsStatus, LiveClock } from "./record/live-stats";
import { OptionRow, Toggle } from "./record/option-row";
import { usePref } from "./record/prefs";
import { SaveForm } from "./record/save-form";
import { emptySets, type StrengthExercise } from "./record/strength";
import { StrengthLogger } from "./record/strength-logger";
import { TypeTiles } from "./record/type-tiles";
import { WorkoutPlan } from "./record/workout-plan";
import { TrainTabs } from "./train-tabs";

type Phase = "idle" | "recording" | "paused" | "saving";

export function RecordPage() {
  const router = useRouter();
  const t = useT();
  const units = useUnits();
  const invalidate = useInvalidateAll();
  const { data: stats } = useAthleteStats();

  const [phase, setPhase] = useState<Phase>("idle");
  const [type, setType] = useState<ActivityType | "HYROX">("RUN");
  const [division, setDivision] = useState<Division>("MEN_OPEN");
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState("");
  // Read without asking, so the setup screen can say whether real GPS is even
  // an option before anybody presses Start.
  const [locationPermission, setLocationPermission] = useLocationPermission();
  const [askingLocation, setAskingLocation] = useState(false);
  const [trackLaps, setTrackLaps] = usePref("laps");
  const [audioCues, setAudioCues] = usePref("cues");
  const [laps, setLaps] = useState<number[]>([]);
  const [exercises, setExercises] = useState<StrengthExercise[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [gpsError, setGpsError] = useState("");
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(0);
  const [startedAt, setStartedAt] = useState(0);

  const startTsRef = useRef(0);
  const pausedRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const lastFixRef = useRef<AcceptedFix | null>(null);
  const needsSegmentRef = useRef(false);
  const pausedAtRef = useRef(0);
  const pausedMsRef = useRef(0);
  const lastKmRef = useRef(0);
  const aliveRef = useRef(true);

  // Keep the display awake where supported. Mobile browsers may still suspend
  // location when the tab is backgrounded or the device is locked.
  useEffect(() => {
    if (phase !== "recording" || type === "WORKOUT") return;
    let active = true;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || !navigator.wakeLock) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (active) lock = next;
        else void next.release();
      } catch {
        // Tracking still works when the device does not support screen wake lock.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (lock) void lock.release();
    };
  }, [phase, type]);

  const appendPoint = useCallback((pos: GeolocationPosition, kind: "RUN" | "RIDE" | "WALK") => {
    if (pausedRef.current) return;
    setGpsAccuracyM(pos.coords.accuracy);
    setLastFixAt(Date.now());
    if (pos.coords.accuracy <= 50) setGpsError("");
    const result = acceptGpsFix({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: pos.coords.accuracy,
      at: pos.timestamp,
      altitude: pos.coords.altitude ?? undefined,
    }, lastFixRef.current, startTsRef.current + pausedMsRef.current, kind, needsSegmentRef.current);
    if (!result) return;
    lastFixRef.current = result.accepted;
    needsSegmentRef.current = false;
    setGpsError("");
    setDistanceM((d) => d + result.distanceM);
    setPoints((prev) => [...prev, result.accepted.point]);
  }, []);

  const stopSources = useCallback(() => {
    for (const id of timersRef.current) clearInterval(id);
    timersRef.current = [];
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopSources();
    };
  }, [stopSources]);

  const start = async () => {
    let initialPosition: GeolocationPosition | null = null;
    if (type !== "WORKOUT" && type !== "HYROX") {
      if (!navigator.geolocation || !window.isSecureContext) {
        setGpsError("GPS needs location access and a secure connection (https).");
        return;
      }
      setAskingLocation(true);
      setGpsError("");
      try {
        initialPosition = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000,
          }),
        );
        if (!aliveRef.current) return;
        if (initialPosition.coords.accuracy > 50) {
          setGpsError("GPS accuracy is too low. Move outdoors and try again.");
          return;
        }
        setLocationPermission("granted");
      } catch (error) {
        if (!aliveRef.current) return;
        const geoError = error as GeolocationPositionError;
        if (geoError.code === 1) setLocationPermission("denied");
        setGpsError(geoError.code === 1
          ? "Location is blocked for this site. Allow it in your browser settings and start again."
          : "Could not get a GPS fix. Move outdoors and try again.");
        return;
      } finally {
        setAskingLocation(false);
      }
    }
    setPoints([]);
    setDistanceM(0);
    setElapsedSec(0);
    setLaps([]);
    lastKmRef.current = 0;
    setGpsError("");
    setGpsAccuracyM(null);
    setLastFixAt(null);
    startTsRef.current = Date.now();
    setStartedAt(startTsRef.current);
    pausedRef.current = false;
    pausedAtRef.current = 0;
    pausedMsRef.current = 0;
    lastFixRef.current = null;
    needsSegmentRef.current = false;
    setPhase("recording");
    if (initialPosition && type !== "WORKOUT" && type !== "HYROX") {
      appendPoint(initialPosition, type);
    }

    timersRef.current.push(
      window.setInterval(() => {
        setClockNow(Date.now());
        const activeMs = (pausedRef.current ? pausedAtRef.current : Date.now()) - startTsRef.current - pausedMsRef.current;
        setElapsedSec(Math.max(0, Math.floor(activeMs / 1000)));
      }, 1000),
    );

    if (type === "WORKOUT" || type === "HYROX") return; // timer only / guided

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => appendPoint(pos, type),
      (err) => {
        needsSegmentRef.current = true;
        if (err.code === 1) setLocationPermission("denied");
        setGpsError(
          err.code === 1
            ? "Location is blocked for this site. Allow it in your browser settings and start again."
            : "Lost the GPS fix. The timer is still running - the route will pick up when the signal returns.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  // Audio cue at every completed kilometre (skipped when speech synthesis is unavailable).
  useEffect(() => {
    const km = Math.floor(distanceM / 1000);
    if (!audioCues || phase !== "recording" || km <= lastKmRef.current) return;
    lastKmRef.current = km;
    try {
      const pace = distanceM > 0 ? (elapsedSec / distanceM) * 1000 : 0;
      const mm = Math.floor(pace / 60);
      const ss = Math.round(pace % 60);
      const u = new SpeechSynthesisUtterance(
        `${km} kilometer${km > 1 ? "s" : ""}. Average pace ${mm} ${ss < 10 ? "oh " : ""}${ss} per kilometer.`,
      );
      window.speechSynthesis?.speak(u);
    } catch {
      /* no speech support */
    }
  }, [distanceM, audioCues, phase, elapsedSec]);

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    if (pausedRef.current) {
      pausedAtRef.current = Date.now();
      setElapsedSec(Math.max(0, Math.floor((pausedAtRef.current - startTsRef.current - pausedMsRef.current) / 1000)));
    } else {
      pausedMsRef.current += Date.now() - pausedAtRef.current;
      needsSegmentRef.current = true;
    }
    setPhase(pausedRef.current ? "paused" : "recording");
  };

  const finish = () => {
    const finishedMs = (pausedRef.current ? pausedAtRef.current : Date.now()) - startTsRef.current - pausedMsRef.current;
    if (!pausedRef.current) {
      setElapsedSec(Math.max(0, Math.floor(finishedMs / 1000)));
    }
    if (type !== "WORKOUT") {
      setPoints((previous) => previous.length > 0
        ? [...previous, { ...previous[previous.length - 1]!, t: Math.max(previous[previous.length - 1]!.t + 1, finishedMs) }]
        : previous);
    }
    pausedRef.current = true;
    stopSources();
    setPhase("saving");
  };

  const discard = () => {
    stopSources();
    setPhase("idle");
    setPoints([]);
    setDistanceM(0);
    setElapsedSec(0);
  };

  // Generate a full HYROX simulation and drop straight into the guided
  // station-by-station session (which saves to the feed as a WORKOUT).
  const startHyroxSim = async () => {
    setSimBusy(true);
    setSimError("");
    try {
      const workout = await workoutApi.workout.generate({
        type: "FULL_SIMULATION",
        division,
        stationOrders: [],
        excludedExerciseIds: [],
      });
      const session = await workoutApi.workout.start(workout.id);
      router.push(m(`/workout/active/${session.session.id}`));
    } catch (e) {
      setSimError(
        e instanceof ApiError
          ? e.message
          : t("Could not start the simulation."),
      );
      setSimBusy(false);
    }
  };

  const avgPace = distanceM > 50 ? (elapsedSec / distanceM) * 1000 : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("Record")}</h1>
      <TrainTabs />

      {phase === "idle" ? (
        <>
          <TypeTiles type={type} onSelect={setType} />
          {type === "HYROX" ? null : type !== "WORKOUT" ? (
            <div className="flex flex-col gap-3">
              {/* Asked here rather than at Start: a prompt in the middle of a run
                  is the moment somebody is least inclined to read it. */}
              <LocationGate
                permission={locationPermission}
                error={null}
                locating={askingLocation}
                reason="So your run is drawn on the map and your distance and pace are real."
                onRequest={() => {
                  setAskingLocation(true);
                  navigator.geolocation.getCurrentPosition(
                    () => {
                      setLocationPermission("granted");
                      setGpsError("");
                      setAskingLocation(false);
                    },
                    (err) => {
                      if (err.code === 1) setLocationPermission("denied");
                      setGpsError(
                        err.code === 1
                          ? "Location is blocked for this site. Allow it in your browser settings, then reload."
                          : "Could not get a fix yet - you can still start, and it will pick you up outside.",
                      );
                      setAskingLocation(false);
                    },
                    { enableHighAccuracy: true, timeout: 15000 },
                  );
                }}
              />
              {gpsError ? (
                <p className="text-xs font-bold text-nh-danger">
                  {t(gpsError)}
                </p>
              ) : null}
            </div>
          ) : (
            <WorkoutPlan
              exercises={exercises}
              onAdd={() => setPickerOpen(true)}
              onRemove={(i) =>
                setExercises((prev) => prev.filter((_, j) => j !== i))
              }
            />
          )}
          {type !== "HYROX" ? (
            <button
              onClick={() => void start()}
              disabled={askingLocation || (type !== "WORKOUT" && (locationPermission === "denied" || locationPermission === "insecure" || locationPermission === "unsupported"))}
              className="nh-btn-brand flex items-center justify-center gap-2 !py-5 text-lg disabled:opacity-50"
            >
              <Play size={22} fill="currentColor" /> {askingLocation ? t("Finding you…") : t("Start")}
            </button>
          ) : (
            <HyroxSimCard
              division={division}
              onDivision={setDivision}
              simError={simError}
              simBusy={simBusy}
              onStart={() => void startHyroxSim()}
            />
          )}

          {type !== "HYROX" && type !== "WORKOUT" ? (
            <div className="nh-card divide-y divide-nh-line !p-2">
              <OptionRow
                icon={Timer}
                label={t("Track laps")}
                hint={t("Adds a Lap button while recording")}
                right={<Toggle on={trackLaps} onChange={setTrackLaps} label={t("Track laps")} />}
              />
              <OptionRow
                icon={Volume2}
                label={t("Audio cues")}
                hint={t("Spoken split every kilometre")}
                right={<Toggle on={audioCues} onChange={setAudioCues} label={t("Audio cues")} />}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {pickerOpen ? (
        <ExercisePicker
          chosen={exercises.map((ex) => ex.name)}
          onPick={(name, muscle) => {
            setExercises((prev) => [
              ...prev,
              { name, muscle, sets: emptySets() },
            ]);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {phase === "recording" || phase === "paused" ? (
        <>
          <LiveClock
            type={type}
            paused={phase === "paused"}
            elapsedSec={elapsedSec}
            distanceM={distanceM}
            avgPace={avgPace}
            units={units}
          />
          {type !== "WORKOUT" ? (
            <GpsStatus
              paused={phase === "paused"}
              lastFixAt={lastFixAt}
              clockNow={clockNow}
              gpsAccuracyM={gpsAccuracyM}
              gpsError={gpsError}
            />
          ) : null}
          {type === "WORKOUT" && exercises.length > 0 ? (
            <StrengthLogger exercises={exercises} setExercises={setExercises} />
          ) : null}
          {trackLaps ? (
            <LapBar
              laps={laps}
              paused={phase === "paused"}
              onLap={() => setLaps((prev) => [...prev, elapsedSec])}
            />
          ) : null}
          {type !== "WORKOUT" && points.length > 0 ? (
            <GeoMap tracks={[{ points }]} height={220} interactive={false} />
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={togglePause}
              className="nh-btn-ghost flex items-center justify-center gap-2"
            >
              {phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
              {phase === "paused" ? t("Resume") : t("Pause")}
            </button>
            <button
              onClick={finish}
              className="nh-btn-brand flex items-center justify-center gap-2"
            >
              <Square size={16} fill="currentColor" /> {t("Finish")}
            </button>
          </div>
        </>
      ) : null}

      {phase === "saving" ? (
        <SaveForm
          type={type === "HYROX" ? "WORKOUT" : type}
          strength={exercises}
          laps={laps}
          points={points}
          elapsedSec={elapsedSec}
          distanceM={distanceM}
          startedAt={startedAt}
          gear={(stats?.gear ?? []).filter((g) => !g.retired)}
          onDiscard={discard}
          onSaved={(id) => {
            invalidate();
            router.push(m(`/train/activities/${id}`));
          }}
        />
      ) : null}
    </div>
  );
}
