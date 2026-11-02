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
const DRAFT_KEY = "nuhabit-activity-draft-v1";

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
  const [draftReady, setDraftReady] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [hasFinished, setHasFinished] = useState(false);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);

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
  const leaveDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY);
        if (raw) {
          try {
            const draft = JSON.parse(raw) as { type: ActivityType; startedAt: number; elapsedSec: number; distanceM: number; points: TrackPoint[]; laps: number[]; exercises: StrengthExercise[] };
            if (draft.startedAt > 0 && Array.isArray(draft.points)) {
              setType(draft.type);
              setStartedAt(draft.startedAt);
              setElapsedSec(draft.elapsedSec);
              setDistanceM(draft.distanceM);
              setPoints(draft.points);
              setLaps(draft.laps ?? []);
              setExercises(draft.exercises ?? []);
              setPhase("saving");
              setRecovered(true);
              setHasFinished(true);
              const now = Date.now();
              startTsRef.current = now - Math.max(0, draft.elapsedSec) * 1000;
              pausedAtRef.current = now;
              pausedRef.current = true;
              needsSegmentRef.current = true;
            }
          } catch { window.localStorage.removeItem(DRAFT_KEY); }
        }
        const probe = `${DRAFT_KEY}-probe`;
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
      } catch { setDraftStorageError(true); }
      setDraftReady(true);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try {
      if (phase === "idle") window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ type, startedAt, elapsedSec, distanceM, points, laps, exercises }));
    } catch { queueMicrotask(() => setDraftStorageError(true)); }
  }, [draftReady, phase, type, startedAt, elapsedSec, distanceM, points, laps, exercises]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  useEffect(() => {
    if (!leaveHref) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveDialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setLeaveHref(null); return; }
      if (event.key !== "Tab") return;
      const buttons = [...(leaveDialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [leaveHref]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const guardLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.getAttribute("target") === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveHref(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", guardLink, true);
    return () => document.removeEventListener("click", guardLink, true);
  }, [phase]);

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
  const startSources = useCallback((kind: ActivityType) => {
    stopSources();
    timersRef.current.push(window.setInterval(() => {
      setClockNow(Date.now());
      const activeMs = (pausedRef.current ? pausedAtRef.current : Date.now()) - startTsRef.current - pausedMsRef.current;
      setElapsedSec(Math.max(0, Math.floor(activeMs / 1000)));
    }, 1000));
    if (kind === "WORKOUT") return;
    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => appendPoint(pos, kind),
        (err) => {
          needsSegmentRef.current = true;
          if (err.code === 1) setLocationPermission("denied");
          setGpsError(err.code === 1
            ? "Location is blocked for this site. Allow it in your browser settings and start again."
            : "Lost the GPS fix. The timer is still running; the route will continue when the signal returns.");
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      setGpsError("GPS could not restart. The timer is still running; you can save without a route.");
    }
  }, [appendPoint, setLocationPermission, stopSources]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopSources();
    };
  }, [stopSources]);

  const start = async () => {
    if (!draftReady || draftStorageError) return;
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
    setRecovered(false);
    if (initialPosition && type !== "WORKOUT" && type !== "HYROX") {
      appendPoint(initialPosition, type);
    }

    if (type !== "HYROX") startSources(type);
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
      const cue = type === "RIDE"
        ? `Average speed ${elapsedSec > 0 ? (distanceM / elapsedSec * 3.6).toFixed(1) : "0"} kilometers per hour.`
        : `Average pace ${mm} ${ss < 10 ? "oh " : ""}${ss} per kilometer.`;
      const u = new SpeechSynthesisUtterance(`${km} kilometer${km > 1 ? "s" : ""}. ${cue}`);
      window.speechSynthesis?.speak(u);
    } catch {
      /* no speech support */
    }
  }, [distanceM, audioCues, phase, elapsedSec, type]);

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
    if (!pausedRef.current) pausedAtRef.current = Date.now();
    pausedRef.current = true;
    stopSources();
    setHasFinished(true);
    setPhase("saving");
  };

  const resumeAfterFinish = () => {
    if (type === "HYROX") return;
    pausedMsRef.current += Date.now() - pausedAtRef.current;
    pausedRef.current = false;
    needsSegmentRef.current = true;
    setRecovered(false);
    setPhase("recording");
    startSources(type);
  };

  const leaveWithDraft = () => {
    if (!leaveHref) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ type, startedAt, elapsedSec, distanceM, points, laps, exercises }));
    } catch { setDraftStorageError(true); return; }
    router.push(leaveHref);
  };

  const discard = () => {
    stopSources();
    setPhase("idle");
    setHasFinished(false);
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
          {draftStorageError ? <p role="alert" className="nh-card text-sm font-bold text-nh-danger">This browser cannot save an activity draft. Free up browser storage or enable site storage, then reload before recording.</p> : null}
          <TypeTiles type={type} onSelect={setType} />
          {type === "HYROX" ? null : type !== "WORKOUT" ? (
            <div className="flex flex-col gap-3">
              {locationPermission === "denied" || locationPermission === "insecure" || locationPermission === "unsupported" ? (
                <LocationGate permission={locationPermission} error={null} locating={false} reason="GPS is required to record a route." onRequest={() => undefined} />
              ) : (
                <p role="status" className="nh-card text-sm text-nh-forest">
                  {askingLocation ? "Finding an accurate GPS signal…" : locationPermission === "granted"
                    ? "Location access is ready. Press Start to find a GPS signal and begin recording."
                    : "Press Start to allow location and begin recording when GPS is accurate."}
                </p>
              )}
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
              disabled={!draftReady || draftStorageError || askingLocation || (type !== "WORKOUT" && (locationPermission === "denied" || locationPermission === "insecure" || locationPermission === "unsupported"))}
              className="nh-btn-brand flex items-center justify-center gap-2 !py-5 text-lg disabled:opacity-50"
            >
              <Play size={22} fill="currentColor" /> {askingLocation ? t("Finding GPS…") : t(type === "WORKOUT" ? "Start" : "Start GPS recording")}
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
          {draftStorageError ? <p role="alert" className="nh-card text-sm font-bold text-nh-danger">Your activity draft could not be saved. Keep this page open and finish the activity soon.</p> : null}
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

      {hasFinished ? (
        <div hidden={phase !== "saving"} className="space-y-5">
        {recovered ? <p role="status" className="nh-card text-sm font-bold text-nh-forest">Your activity was recovered. Recording stopped when you left the page; review the saved route before posting.</p> : null}
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
          onResume={resumeAfterFinish}
          onSaved={(id) => {
            try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* Activity is already saved on the server. */ }
            invalidate();
            router.push(m(`/train/activities/${id}`));
          }}
        />
        </div>
      ) : null}
      {leaveHref ? (
        <div ref={leaveDialogRef} role="dialog" aria-modal="true" aria-labelledby="leave-recording-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5">
          <div className="nh-card w-full max-w-sm space-y-4">
            <h2 id="leave-recording-title" className="nh-display text-xl">Leave recording?</h2>
            <p className="text-sm text-nh-muted">GPS and the timer will stop. Your activity draft will be ready to review when you return.</p>
            <button className="nh-btn-brand w-full" onClick={() => setLeaveHref(null)}>Keep recording</button>
            <button className="nh-btn-ghost w-full" onClick={leaveWithDraft}>Leave and save draft</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
