"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bike,
  Check,
  Dumbbell,
  Flame,
  Footprints,
  ImagePlus,
  Pause,
  PersonStanding,
  Play,
  Square,
  Timer,
  Volume2,
  X,
} from "lucide-react";
import type { Division } from "@/lib/gym/hyrox";
import { gearKindFor } from "@/lib/gym/athlete";
import { GeoMap } from "../components/geo-map";
import { LocationGate } from "../components/location-gate";
import { ApiError } from "../lib/api";
import { acceptGpsFix, type AcceptedFix } from "../lib/gps-track";
import { useLocationPermission } from "../lib/geolocation";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import {
  trainApi,
  useAthleteStats,
  useInvalidateAll,
  useUnits,
  type ActivityType,
  type ActivityVisibility,
  type TrackPoint,
} from "../lib/queries-train";
import { api as workoutApi } from "../lib/queries-workout";
import { formatDistanceM, formatDuration, formatPace } from "../ui";
import { TrainTabs } from "./train-tabs";
import { VisibilityPicker } from "./visibility-picker";

type Phase = "idle" | "recording" | "paused" | "saving";

const DIVISIONS: { id: Division; label: string }[] = [
  { id: "MEN_OPEN", label: "Men Open" },
  { id: "WOMEN_OPEN", label: "Women Open" },
  { id: "MEN_PRO", label: "Men Pro" },
  { id: "WOMEN_PRO", label: "Women Pro" },
];

/** Recording preferences survive reloads (localStorage, per browser). */
const prefGet = (key: string): boolean => {
  try {
    return localStorage.getItem(`hyrox.rec.${key}`) === "1";
  } catch {
    return false;
  }
};
const prefSet = (key: string, value: boolean) => {
  try {
    localStorage.setItem(`hyrox.rec.${key}`, value ? "1" : "0");
  } catch {
    /* private mode */
  }
};
const noSubscribe = () => () => {};

/** A saved toggle: false on the server, the stored value after hydration, persisted on change. */
function usePref(key: string): [boolean, (next: boolean) => void] {
  const saved = useSyncExternalStore(
    noSubscribe,
    () => prefGet(key),
    () => false,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const set = (next: boolean) => {
    setOverride(next);
    prefSet(key, next);
  };
  return [override ?? saved, set];
}

/** Resize an image file to a small JPEG data URL (stored with the activity). */
function resizeImageToDataUrl(
  file: File,
  maxDim: number,
  quality = 0.7,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`h-7 w-12 shrink-0 rounded-full p-1 transition ${on ? "bg-nh-forest" : "bg-nh-line"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

function OptionRow({
  icon: Icon,
  label,
  hint,
  right,
  onClick,
}: {
  icon: typeof Timer;
  label: string;
  hint?: string;
  right: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className="flex w-full items-center gap-3 px-2 py-3 text-left active:bg-nh-raised"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-bold">{label}</span>
        {hint ? (
          <span className="block truncate text-xs text-nh-muted">{hint}</span>
        ) : null}
      </span>
      {right}
    </Tag>
  );
}

const EXERCISE_LIBRARY: Record<string, string[]> = {
  Back: ["Lat Pulldown", "Barbell Row", "Seated Cable Row", "Pull-up"],
  Chest: ["Bench Press", "Incline DB Press", "Cable Fly", "Push-up"],
  Legs: ["Back Squat", "Leg Press", "Romanian Deadlift", "Walking Lunge"],
  Shoulders: ["Overhead Press", "Lateral Raise", "Rear Delt Fly"],
  Arms: ["Bicep Curl", "Hammer Curl", "Tricep Pushdown", "Skullcrusher"],
  Core: ["Plank", "Hanging Knee Raise", "Cable Crunch"],
  Glutes: ["Hip Thrust", "Glute Bridge", "Cable Kickback"],
  "Full body": ["Deadlift", "Clean & Press", "Kettlebell Swing", "Burpee"],
};

interface StrengthSet {
  kg: string;
  reps: string;
  done: boolean;
}
interface StrengthExercise {
  name: string;
  muscle: string;
  sets: StrengthSet[];
}
const emptySets = (): StrengthSet[] =>
  Array.from({ length: 3 }, () => ({ kg: "", reps: "", done: false }));

const TYPE_TILES: {
  id: ActivityType | "HYROX";
  label: string;
  hint: string;
  icon: typeof Footprints;
}[] = [
  { id: "RUN", label: "Run", hint: "GPS tracked", icon: Footprints },
  { id: "RIDE", label: "Ride", hint: "GPS tracked", icon: Bike },
  { id: "WALK", label: "Walk", hint: "GPS tracked", icon: PersonStanding },
  { id: "WORKOUT", label: "Workout", hint: "Sets & reps", icon: Dumbbell },
  { id: "HYROX", label: "HYROX Sim", hint: "Guided race", icon: Flame },
];

function defaultTitle(type: ActivityType): string {
  const hour = new Date().getHours();
  const daypart =
    hour < 11
      ? "Morning"
      : hour < 15
        ? "Lunch"
        : hour < 19
          ? "Evening"
          : "Night";
  const noun = { RUN: "Run", RIDE: "Ride", WALK: "Walk", WORKOUT: "Workout" }[
    type
  ];
  return `${daypart} ${noun}`;
}

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
  const updateSet = (ei: number, si: number, patch: Partial<StrengthSet>) =>
    setExercises((prev) =>
      prev.map((x, j) =>
        j === ei
          ? {
              ...x,
              sets: x.sets.map((ss, k) =>
                k === si ? { ...ss, ...patch } : ss,
              ),
            }
          : x,
      ),
    );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl">{t("Record")}</h1>
      <TrainTabs />

      {phase === "idle" ? (
        <>
          <div>
            <p className="nh-label">{t("Activity type")}</p>
            <div className="-mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
              {TYPE_TILES.map(({ id, label, hint, icon: Icon }) => {
                const selected = type === id;
                return (
                  <button
                    key={id}
                    onClick={() => setType(id)}
                    className={`flex min-w-[104px] shrink-0 snap-start flex-col items-start gap-2.5 rounded-2xl p-3.5 text-left transition active:scale-[0.97] ${
                      selected
                        ? "nh-surface-ink text-white shadow-[0_10px_26px_rgb(0_40_26/0.3)]"
                        : "nh-card !p-3.5"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${
                        selected
                          ? "nh-surface-brand text-nh-ink"
                          : "bg-nh-ink-soft text-white"
                      }`}
                    >
                      <Icon size={17} strokeWidth={2.2} />
                    </span>
                    <span>
                      <span className="block text-sm leading-tight font-extrabold">
                        {t(label)}
                      </span>
                      <span
                        className={`block text-[11px] font-semibold ${selected ? "text-white/55" : "text-nh-muted"}`}
                      >
                        {t(hint)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
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
            <div className="nh-card">
              <div className="mb-2 flex items-center justify-between">
                <p className="nh-label !mb-0">{t("Your workout")}</p>
                <button
                  className="text-sm font-bold text-nh-forest"
                  onClick={() => setPickerOpen(true)}
                >
                  {t("+ Add exercise")}
                </button>
              </div>
              {exercises.length === 0 ? (
                <p className="text-sm text-nh-muted">
                  {t(
                    "Build it like the gym log: add exercises, then track sets, kg and reps while you train.",
                  )}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-nh-line">
                  {exercises.map((ex, i) => (
                    <div
                      key={ex.name}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
                        <Dumbbell size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold">
                          {ex.name}
                        </p>
                        <p className="text-xs text-nh-muted">
                          {ex.muscle} · {ex.sets.length} {t("sets")}
                        </p>
                      </div>
                      <button
                        className="text-nh-muted"
                        aria-label={`${t("Remove")} ${ex.name}`}
                        onClick={() =>
                          setExercises((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
            <div className="nh-card nh-surface-ink relative overflow-hidden !border-0 !p-6 text-white">
              <div className="pointer-events-none absolute -top-24 -right-16 h-56 w-56 rounded-full bg-nh-lime/20 blur-3xl" />
              <div className="relative">
                <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] text-white/50 uppercase">
                  <Flame size={13} className="text-nh-lime" />{" "}
                  {t("HYROX simulation")}
                </p>
                <p className="nh-display mt-1 text-2xl leading-tight">
                  {t("8 runs. 8 stations. Race pace.")}
                </p>
                <p className="mt-1.5 text-sm text-white/60">
                  {t(
                    "Guided station by station with your division loads - timed like race day.",
                  )}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {DIVISIONS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDivision(d.id)}
                      className={`rounded-xl px-3 py-2 text-xs font-black uppercase transition ${
                        division === d.id
                          ? "bg-white text-nh-ink"
                          : "bg-white/10 text-white/60 hover:bg-white/15"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                {simError ? (
                  <p className="mt-3 text-sm font-bold text-nh-lime">
                    {simError}
                  </p>
                ) : null}
                <button
                  onClick={() => void startHyroxSim()}
                  disabled={simBusy}
                  className="nh-btn-brand mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-40"
                >
                  <Play size={18} fill="currentColor" />
                  {simBusy ? t("Preparing…") : t("Start simulation")}
                </button>
                <p className="mt-2.5 text-center text-xs text-white/40">
                  {t(
                    "Finishing saves it to your training feed and race readiness.",
                  )}
                </p>
              </div>
            </div>
          )}

          {type !== "HYROX" && type !== "WORKOUT" ? (
            <div className="nh-card divide-y divide-nh-line !p-2">
              <OptionRow
                icon={Timer}
                label={t("Track laps")}
                hint={t("Adds a Lap button while recording")}
                right={<Toggle on={trackLaps} onChange={setTrackLaps} />}
              />
              <OptionRow
                icon={Volume2}
                label={t("Audio cues")}
                hint={t("Spoken split every kilometre")}
                right={<Toggle on={audioCues} onChange={setAudioCues} />}
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
          <div className="nh-card flex flex-col items-center gap-1 !py-8">
            <p className="nh-label !mb-0">{t("Time")}</p>
            <p className="nh-display text-7xl leading-none">
              {formatDuration(elapsedSec)}
            </p>
            {type !== "WORKOUT" ? (
              <div className="mt-4 flex gap-8 text-center">
                <div>
                  <p className="nh-label !mb-0">{t("Distance")}</p>
                  <p className="nh-display text-3xl">
                    {formatDistanceM(distanceM, units)}
                  </p>
                </div>
                <div>
                  <p className="nh-label !mb-0">{t("Avg pace")}</p>
                  <p className="nh-display text-3xl">
                    {formatPace(avgPace, units)}
                  </p>
                </div>
              </div>
            ) : null}
            {phase === "paused" ? (
              <p className="mt-3 text-xs font-black tracking-widest text-nh-warn uppercase">
                {t("Paused")}
              </p>
            ) : null}
          </div>
          {type !== "WORKOUT" ? (
            <div className="nh-card !py-3 text-sm">
              <p className="font-bold">
                {t(phase === "paused" ? "GPS paused" : !lastFixAt ? "Finding GPS signal…" : clockNow - lastFixAt > 15000 ? "GPS signal lost" : gpsAccuracyM !== null && gpsAccuracyM > 50 ? "GPS signal weak" : "GPS recording")}
              </p>
              {gpsAccuracyM !== null ? (
                <p className="text-xs text-nh-muted">{t("Location accuracy")}: ±{Math.round(gpsAccuracyM)} m</p>
              ) : null}
              {gpsAccuracyM !== null && gpsAccuracyM > 50 ? (
                <p className="text-xs text-nh-warn">{t("Move outdoors for a more accurate route.")}</p>
              ) : null}
              {gpsError ? <p className="mt-1 text-xs text-nh-danger">{t(gpsError)}</p> : null}
              <p className="mt-1 text-xs text-nh-muted">{t("Keep this page open while recording; background GPS depends on your browser.")}</p>
            </div>
          ) : null}
          {type === "WORKOUT" && exercises.length > 0 ? (
            <div className="flex flex-col gap-3">
              {exercises.map((ex, ei) => (
                <div key={ex.name} className="nh-card !py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-extrabold">{ex.name}</p>
                    <span className="nh-chip bg-nh-raised text-nh-muted">
                      {ex.muscle}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    <div className="grid grid-cols-[2rem_1fr_1fr_2.5rem] gap-2 text-[10px] font-extrabold tracking-wider text-nh-muted uppercase">
                      <span>{t("Set")}</span>
                      <span>kg</span>
                      <span>{t("Reps")}</span>
                      <span />
                    </div>
                    {ex.sets.map((set, si) => (
                      <div
                        key={si}
                        className={`grid grid-cols-[2rem_1fr_1fr_2.5rem] items-center gap-2 rounded-xl px-0.5 py-0.5 ${
                          set.done ? "bg-nh-ok/10" : ""
                        }`}
                      >
                        <span className="text-center text-sm font-black text-nh-muted">
                          {si + 1}
                        </span>
                        <input
                          inputMode="decimal"
                          placeholder="-"
                          value={set.kg}
                          onChange={(e) =>
                            updateSet(ei, si, { kg: e.target.value })
                          }
                          className="nh-input !rounded-lg !px-2.5 !py-1.5 text-center text-sm"
                        />
                        <input
                          inputMode="numeric"
                          placeholder="-"
                          value={set.reps}
                          onChange={(e) =>
                            updateSet(ei, si, { reps: e.target.value })
                          }
                          className="nh-input !rounded-lg !px-2.5 !py-1.5 text-center text-sm"
                        />
                        <button
                          aria-label={t("Set done")}
                          onClick={() => updateSet(ei, si, { done: !set.done })}
                          className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full ${
                            set.done
                              ? "bg-nh-ok text-white"
                              : "bg-nh-raised text-nh-muted"
                          }`}
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="mt-1 self-start text-xs font-bold text-nh-forest"
                      onClick={() =>
                        setExercises((prev) =>
                          prev.map((x, j) =>
                            j === ei
                              ? {
                                  ...x,
                                  sets: [
                                    ...x.sets,
                                    { kg: "", reps: "", done: false },
                                  ],
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      {t("+ Add set")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {trackLaps ? (
            <div className="nh-card flex items-center gap-3 !py-3">
              <button
                onClick={() => setLaps((prev) => [...prev, elapsedSec])}
                disabled={phase === "paused"}
                className="nh-btn-ghost shrink-0 !px-5 !py-2.5 text-sm disabled:opacity-40"
              >
                {t("Lap")} {laps.length + 1}
              </button>
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {laps.map((at, i) => (
                  <span
                    key={i}
                    className="nh-chip shrink-0 bg-nh-raised text-nh-muted"
                  >
                    {i + 1} · {formatDuration(at - (laps[i - 1] ?? 0))}
                  </span>
                ))}
                {laps.length === 0 ? (
                  <span className="text-xs text-nh-muted">
                    {t("Tap to mark a lap.")}
                  </span>
                ) : null}
              </div>
            </div>
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

function SaveForm({
  type,
  strength,
  laps,
  points,
  elapsedSec,
  distanceM,
  startedAt,
  gear,
  onDiscard,
  onSaved,
}: {
  type: ActivityType;
  strength: StrengthExercise[];
  laps: number[];
  points: TrackPoint[];
  elapsedSec: number;
  distanceM: number;
  startedAt: number;
  gear: { id: string; name: string; kind: string }[];
  onDiscard: () => void;
  onSaved: (activityId: string) => void;
}) {
  const t = useT();
  const units = useUnits();
  const muscles = [...new Set(strength.map((ex) => ex.muscle))];
  const [title, setTitle] = useState(() =>
    type === "WORKOUT" && muscles.length > 0
      ? `${muscles.slice(0, 2).join(" & ")} Workout`
      : defaultTitle(type),
  );
  const [description, setDescription] = useState(() =>
    [
      ...strength
        .filter((ex) => ex.sets.some((set) => set.kg || set.reps || set.done))
        .map(
          (ex) =>
            `${ex.name}: ${ex.sets
              .filter((set) => set.kg || set.reps || set.done)
              .map((set) => `${set.kg || "-"}kg×${set.reps || "-"}`)
              .join(", ")}`,
        ),
      laps.length > 0
        ? `Laps: ${laps.map((at, i) => `${i + 1}) ${formatDuration(at - (laps[i - 1] ?? 0))}`).join("  ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const [gearId, setGearId] = useState("");
  const [visibility, setVisibility] = useState<ActivityVisibility>("EVERYONE");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addPhoto = async (file: File | undefined) => {
    if (!file || photos.length >= 2) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 640);
      setPhotos((p) => [...p, dataUrl]);
    } catch {
      setError(t("Could not read that image."));
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await trainApi.save({
        type,
        title,
        description,
        startedAt: new Date(startedAt).toISOString(),
        points,
        manualElapsedSec: type === "WORKOUT" ? Math.max(1, elapsedSec) : null,
        gearId: gearId || null,
        visibility,
        photos,
      });
      onSaved(saved.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="nh-card flex gap-6 text-sm">
        <div>
          <p className="nh-label !mb-0">{t("Time")}</p>
          <p className="nh-display text-xl">{formatDuration(elapsedSec)}</p>
        </div>
        {type !== "WORKOUT" ? (
          <div>
            <p className="nh-label !mb-0">{t("Distance")}</p>
            <p className="nh-display text-xl">
              {formatDistanceM(distanceM, units)}
            </p>
          </div>
        ) : null}
      </div>
      {points.length > 1 ? (
        <GeoMap tracks={[{ points }]} height={180} interactive={false} />
      ) : null}
      {type !== "WORKOUT" && points.length === 0 ? (
        <p className="text-sm text-nh-danger">{t("No GPS route was recorded. Discard this activity and try again outdoors.")}</p>
      ) : null}
      <div>
        <label className="nh-label">{t("Title")}</label>
        <input
          className="nh-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="nh-label">{t("Description")}</label>
        <textarea
          className="nh-input min-h-20"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("How did it go?")}
        />
      </div>
      <div>
        <label className="nh-label">
          {t("Photos")} ({photos.length}/2)
        </label>
        <div className="flex gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p}
                alt=""
                className="h-20 w-20 rounded-xl object-cover"
              />
              <button
                onClick={() =>
                  setPhotos((arr) => arr.filter((_, j) => j !== i))
                }
                className="absolute -top-1.5 -right-1.5 rounded-full bg-nh-ink p-1 text-white"
                aria-label={t("Remove photo")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {photos.length < 2 ? (
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-nh-line text-nh-muted">
              <ImagePlus size={22} />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void addPhoto(e.target.files?.[0])}
              />
            </label>
          ) : null}
        </div>
      </div>
      {gear.length > 0 && type !== "WORKOUT" ? (
        <div>
          <label className="nh-label">{t("Gear")}</label>
          <select
            className="nh-input"
            value={gearId}
            onChange={(e) => setGearId(e.target.value)}
          >
            <option value="">{t("None")}</option>
            {gear
              .filter((g) => g.kind === gearKindFor(type))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <div>
        <label className="nh-label">{t("Who can see this")}</label>
        <VisibilityPicker value={visibility} onChange={setVisibility} />
      </div>
      {error ? (
        <p className="text-sm font-bold text-nh-danger">{error}</p>
      ) : null}
      <button
        className="nh-btn-brand"
        disabled={busy || title.length < 1 || (type !== "WORKOUT" && points.length === 0)}
        onClick={() => void save()}
      >
        {t("Save activity")}
      </button>
      <button className="nh-btn-ghost text-nh-danger" onClick={onDiscard}>
        {t("Discard")}
      </button>
    </div>
  );
}

/** Hevy-style exercise picker, grouped by muscle. */
function ExercisePicker({
  chosen,
  onPick,
  onClose,
}: {
  chosen: string[];
  onPick: (name: string, muscle: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="nh-sheet-panel flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl bg-nh-cream p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="nh-display mb-3 text-xl">{t("Add exercise")}</h2>
        <input
          autoFocus
          className="nh-input mb-3"
          placeholder={t("Search exercises…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex-1 overflow-y-auto">
          {Object.entries(EXERCISE_LIBRARY).map(([muscle, names]) => {
            const visible = names.filter(
              (n) =>
                !q ||
                n.toLowerCase().includes(q) ||
                muscle.toLowerCase().includes(q),
            );
            if (visible.length === 0) return null;
            return (
              <div key={muscle} className="mb-3">
                <p className="mb-1.5 text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">
                  {muscle}
                </p>
                <div className="flex flex-col gap-1">
                  {visible.map((name) => {
                    const taken = chosen.includes(name);
                    return (
                      <button
                        key={name}
                        disabled={taken}
                        onClick={() => onPick(name, muscle)}
                        className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-bold active:bg-nh-raised disabled:opacity-40"
                      >
                        {name}
                        {taken ? (
                          <span className="text-xs font-bold text-nh-ok">
                            {t("Added")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
