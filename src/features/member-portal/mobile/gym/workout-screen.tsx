"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pause, Play, PlayCircle, RotateCcw, Square, Timer, Video } from "lucide-react";
import {
  DIVISION_LABELS,
  DIVISIONS,
  formatDuration,
  RACE_COMPARABLE_SIMILARITY,
  sessionActiveSec,
  sessionCompletionPct,
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPES,
  type Division,
  type WorkoutBlockResult,
  type WorkoutType,
} from "@/lib/gym/hyrox";
import { tanggalPendek } from "../../format";
import { useLocale, useT } from "../mobile-i18n";
import { EmptyCard, ErrorNote, LoadingNote, SectionHeader } from "../mobile-ui";
import {
  blockVolume,
  equipmentLabel,
  gymApi,
  GYM_KEYS,
  toApiResults,
  useWorkoutOptions,
  type WorkoutHistoryItem,
  type WorkoutSessionView,
  type WorkoutView,
} from "./gym-training-api";

const TYPE_HINTS: Record<WorkoutType, string> = {
  FULL_SIMULATION: "8 × (1 km lari + stasiun). Dasar prediksi waktu race.",
  COVERAGE: "4 stasiun, lari 600 m di antaranya.",
  QUICK: "4 stasiun setengah volume, lari 400 m.",
  PRACTICE: "1 stasiun, 3 ronde, lari 200 m.",
};

type Phase =
  | { kind: "setup" }
  | { kind: "preview"; workout: WorkoutView; unresolved: string[] }
  | { kind: "active"; workout: WorkoutView; session: WorkoutSessionView }
  | { kind: "done"; workout: WorkoutView; session: WorkoutSessionView };

/**
 * Generator workout HYROX + pemutar sesi. Alur: pilih tipe, divisi, dan alat →
 * pratinjau blok → timer per blok (jeda/lanjut, selesai blok, berhenti) →
 * ringkasan. Riwayat dan sesi yang belum selesai tampil di layar awal.
 *
 * `onOpenRaces` (opsional) menampilkan tombol ke layar race setelah simulasi penuh.
 */
export function WorkoutScreen({ onOpenRaces }: { onOpenRaces?: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">{t("Workout HYROX")}</h1>
        <p className="mt-1 text-sm text-nh-muted">
          {t("Susun sesi sesuai alat yang ada. Stasiun tanpa alat otomatis diganti latihan setara.")}
        </p>
      </div>
      {phase.kind === "setup" && (
        <Generator
          onGenerated={(workout, unresolved) => setPhase({ kind: "preview", workout, unresolved })}
          onResume={(workout, session) => setPhase({ kind: "active", workout, session })}
        />
      )}
      {phase.kind === "preview" && (
        <Preview
          workout={phase.workout}
          unresolved={phase.unresolved}
          onStart={(session) => setPhase({ kind: "active", workout: phase.workout, session })}
          onBack={() => setPhase({ kind: "setup" })}
        />
      )}
      {phase.kind === "active" && (
        <ActiveSession
          workout={phase.workout}
          initial={phase.session}
          onFinished={(session) => setPhase({ kind: "done", workout: phase.workout, session })}
        />
      )}
      {phase.kind === "done" && (
        <Summary
          workout={phase.workout}
          session={phase.session}
          onNew={() => setPhase({ kind: "setup" })}
          onOpenRaces={onOpenRaces}
        />
      )}
    </div>
  );
}

/* ── Generator ───────────────────────────────────────────────────────── */

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`nh-chip ${active ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-ink"}`}
    >
      {children}
    </button>
  );
}

function Generator({
  onGenerated,
  onResume,
}: {
  onGenerated: (workout: WorkoutView, unresolved: string[]) => void;
  onResume: (workout: WorkoutView, session: WorkoutSessionView) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const options = useWorkoutOptions();
  const [type, setType] = useState<WorkoutType>("COVERAGE");
  const [division, setDivision] = useState<Division>("MEN_OPEN");
  const [stations, setStations] = useState<number[]>([]);
  /** null = semua alat tersedia. */
  const [equipment, setEquipment] = useState<string[] | null>(null);

  const generate = useMutation({
    mutationFn: () =>
      gymApi.generate({
        type,
        division,
        station_orders: type === "FULL_SIMULATION" ? [] : stations,
        available_equipment: equipment,
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.workouts });
      onGenerated(data.workout, data.unresolved_exercise_ids);
    },
  });

  const allEquipment = options.data?.equipment ?? [];
  const toggleEquipment = (code: string) => {
    const current = equipment ?? allEquipment;
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    setEquipment(next.length === allEquipment.length ? null : next);
  };
  const toggleStation = (order: number) =>
    setStations((cur) => (type === "PRACTICE" ? [order] : cur.includes(order) ? cur.filter((o) => o !== order) : [...cur, order]));

  return (
    <>
      <section className="nh-card flex flex-col gap-4">
        <div>
          <p className="nh-label">{t("Tipe sesi")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WORKOUT_TYPES.map((value) => (
              <Chip
                key={value}
                active={type === value}
                onClick={() => {
                  setType(value);
                  setStations([]);
                }}
              >
                {t(WORKOUT_TYPE_LABELS[value])}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-xs text-nh-muted">{t(TYPE_HINTS[type])}</p>
        </div>

        <div>
          <p className="nh-label">{t("Divisi")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DIVISIONS.map((value) => (
              <Chip key={value} active={division === value} onClick={() => setDivision(value)}>
                {DIVISION_LABELS[value]}
              </Chip>
            ))}
          </div>
        </div>

        {type !== "FULL_SIMULATION" && (options.data?.stations.length ?? 0) > 0 && (
          <div>
            <p className="nh-label">
              {type === "PRACTICE" ? t("Stasiun yang dilatih") : t("Stasiun (kosong = acak 4)")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {options.data!.stations.map((s) => (
                <Chip key={s.id} active={stations.includes(s.order)} onClick={() => toggleStation(s.order)}>
                  {s.order}. {s.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {allEquipment.length > 0 && (
          <div>
            <p className="nh-label">{t("Alat yang tersedia hari ini")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {allEquipment.map((code) => (
                <Chip key={code} active={(equipment ?? allEquipment).includes(code)} onClick={() => toggleEquipment(code)}>
                  {equipmentLabel(code)}
                </Chip>
              ))}
            </div>
            {equipment !== null && (
              <button type="button" className="mt-2 text-xs font-bold text-nh-forest" onClick={() => setEquipment(null)}>
                {t("Semua alat tersedia")}
              </button>
            )}
          </div>
        )}

        {generate.error && <ErrorNote>{generate.error.message}</ErrorNote>}
        <button
          type="button"
          className="nh-btn-brand w-full"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? t("Menyusun…") : t("Susun workout")}
        </button>
      </section>

      <History options={options} onResume={onResume} />
    </>
  );
}

function History({
  options,
  onResume,
}: {
  options: ReturnType<typeof useWorkoutOptions>;
  onResume: (workout: WorkoutView, session: WorkoutSessionView) => void;
}) {
  const t = useT();
  const locale = useLocale();
  if (options.isLoading) return <LoadingNote />;
  if (options.error) return <ErrorNote>{options.error.message}</ErrorNote>;
  const workouts = options.data?.workouts ?? [];

  return (
    <section>
      <SectionHeader label={t("Riwayat")} />
      {workouts.length === 0 ? (
        <EmptyCard>{t("Belum ada workout. Sesi pertama akan muncul di sini.")}</EmptyCard>
      ) : (
        <div className="nh-card divide-y divide-nh-line !py-1">
          {workouts.map((w) => (
            <HistoryRow key={w.id} workout={w} locale={locale} onResume={onResume} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  workout,
  locale,
  onResume,
}: {
  workout: WorkoutHistoryItem;
  locale: string;
  onResume: (workout: WorkoutView, session: WorkoutSessionView) => void;
}) {
  const t = useT();
  const latest = workout.sessions[0];
  const open = latest && (latest.status === "started" || latest.status === "paused") ? latest : null;
  const best = workout.sessions.filter((s) => s.status === "completed").map((s) => s.active_sec);
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">{t(WORKOUT_TYPE_LABELS[workout.type])}</p>
        <p className="text-xs text-nh-muted">
          {tanggalPendek(workout.created_at, locale)} · {DIVISION_LABELS[workout.division]} · {t("target")}{" "}
          {formatDuration(workout.total_target_sec)}
        </p>
      </div>
      {open ? (
        <button type="button" className="nh-chip bg-nh-lime text-nh-ink" onClick={() => onResume(workout, open)}>
          <PlayCircle size={14} /> {t("Lanjutkan")}
        </button>
      ) : best.length > 0 ? (
        <span className="text-sm font-bold tabular-nums">{formatDuration(Math.min(...best))}</span>
      ) : (
        <span className="text-xs text-nh-muted">{latest ? t("Parsial") : t("Belum dimulai")}</span>
      )}
    </div>
  );
}

/* ── Pratinjau ───────────────────────────────────────────────────────── */

function BlockList({ workout, results }: { workout: WorkoutView; results?: WorkoutBlockResult[] }) {
  const t = useT();
  return (
    <ol className="nh-card divide-y divide-nh-line !py-1">
      {workout.blocks.map((block) => {
        const result = results?.find((r) => r.order === block.order);
        const weak = block.similarity !== null && block.similarity < RACE_COMPARABLE_SIMILARITY;
        return (
          <li key={block.order} className="flex items-start gap-3 py-3">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                block.kind === "RUN" ? "bg-nh-raised text-nh-ink" : "bg-nh-ink text-white"
              }`}
            >
              {block.order}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold">
                {block.kind === "RUN" && !block.originalExerciseId ? t("Lari") : block.exerciseName}
                {block.videoUrl && (
                  <a
                    href={block.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex align-middle text-nh-forest"
                    aria-label={t("Video {name}", { name: block.exerciseName })}
                  >
                    <Video size={14} />
                  </a>
                )}
              </p>
              <p className="text-xs text-nh-muted">
                {[blockVolume(block), block.weightNote].filter(Boolean).join(" · ")}
              </p>
              {block.originalExerciseName && (
                <p className={`mt-0.5 text-xs ${weak ? "text-nh-warn" : "text-nh-muted"}`}>
                  {t("Pengganti {name}", { name: block.originalExerciseName })}
                  {weak && ` · ${t("tidak setara race")}`}
                </p>
              )}
            </div>
            <span className="shrink-0 text-right text-xs tabular-nums">
              {result ? (
                <span className="font-bold text-nh-ink">{formatDuration(result.durationSec)}</span>
              ) : (
                <span className="text-nh-muted">{formatDuration(block.targetSec)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Preview({
  workout,
  unresolved,
  onStart,
  onBack,
}: {
  workout: WorkoutView;
  unresolved: string[];
  onStart: (session: WorkoutSessionView) => void;
  onBack: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => gymApi.start(workout.id),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.workouts });
      onStart(session);
    },
  });
  const missing = unresolved.length;

  return (
    <>
      <section className="nh-surface-ink rounded-3xl p-5 text-white">
        <p className="text-[11px] font-extrabold tracking-[0.16em] text-white/50 uppercase">
          {t(WORKOUT_TYPE_LABELS[workout.type])} · {DIVISION_LABELS[workout.division]}
        </p>
        <p className="nh-display mt-2 text-4xl">{formatDuration(workout.total_target_sec)}</p>
        <p className="text-sm text-white/60">
          {t("target · {n} blok", { n: workout.blocks.length })}
        </p>
      </section>
      {missing > 0 && (
        <p className="flex gap-2 rounded-2xl bg-nh-warn/10 px-4 py-3 text-sm text-nh-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {t("{n} stasiun tidak punya pengganti dengan alat yang dipilih, jadi tetap muncul apa adanya.", { n: missing })}
        </p>
      )}
      <BlockList workout={workout} />
      {start.error && <ErrorNote>{start.error.message}</ErrorNote>}
      <div className="flex gap-3">
        <button type="button" className="nh-btn-ghost flex-1" onClick={onBack}>
          <RotateCcw size={16} /> {t("Susun ulang")}
        </button>
        <button type="button" className="nh-btn-brand flex-1" disabled={start.isPending} onClick={() => start.mutate()}>
          <Play size={16} /> {t("Mulai")}
        </button>
      </div>
    </>
  );
}

/* ── Sesi aktif ──────────────────────────────────────────────────────── */

/** Stopwatch blok: detik berjalan di luar jeda. Jeda/lanjut dipicu tombol, bukan efek. */
function useBlockClock(initiallyPaused: boolean) {
  const [clock, setClock] = useState(() => {
    const now = Date.now();
    return { startedAt: now, pausedMs: 0, pauseStart: initiallyPaused ? now : (null as number | null) };
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const frozen = clock.pauseStart ?? now;
  return {
    elapsedSec: Math.max(0, Math.floor((frozen - clock.startedAt - clock.pausedMs) / 1000)),
    pause: () => setClock((c) => (c.pauseStart === null ? { ...c, pauseStart: Date.now() } : c)),
    resume: () =>
      setClock((c) =>
        c.pauseStart === null ? c : { ...c, pausedMs: c.pausedMs + Date.now() - c.pauseStart, pauseStart: null }
      ),
    reset: () =>
      setClock((c) => {
        const at = Date.now();
        return { startedAt: at, pausedMs: 0, pauseStart: c.pauseStart === null ? null : at };
      }),
  };
}

function ActiveSession({
  workout,
  initial,
  onFinished,
}: {
  workout: WorkoutView;
  initial: WorkoutSessionView;
  onFinished: (session: WorkoutSessionView) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [session, setSession] = useState(initial);
  const [results, setResults] = useState<WorkoutBlockResult[]>(initial.block_results ?? []);
  const total = workout.blocks.length;
  const paused = session.status === "paused";
  const clock = useBlockClock(initial.status === "paused");
  const currentOrder = Math.min(session.current_block, total);
  const block = workout.blocks.find((b) => b.order === currentOrder) ?? workout.blocks[0]!;
  const next = workout.blocks.find((b) => b.order === currentOrder + 1);

  const act = useMutation({
    mutationFn: (body: Parameters<typeof gymApi.session>[1]) => gymApi.session(session.id, body),
    // Jam sudah dijeda/dilanjutkan saat tombol ditekan; kembalikan bila server menolak.
    onError: (_error, body) => {
      if (body.action === "pause") clock.resume();
      if (body.action === "resume") clock.pause();
    },
    onSuccess: (saved, body) => {
      setSession(saved);
      if (body.action === "complete") {
        void queryClient.invalidateQueries({ queryKey: GYM_KEYS.workouts });
        void queryClient.invalidateQueries({ queryKey: GYM_KEYS.races });
        onFinished(saved);
      }
    },
  });

  const finishBlock = () => {
    const merged = [...results.filter((r) => r.order !== block.order), { order: block.order, durationSec: clock.elapsedSec }];
    setResults(merged);
    clock.reset();
    if (block.order >= total) {
      act.mutate({ action: "complete", block_results: toApiResults(merged), partial: false });
    } else {
      act.mutate({ action: "record", order: block.order, duration_sec: clock.elapsedSec });
    }
  };
  const stop = () =>
    act.mutate({ action: "complete", block_results: toApiResults(results), partial: true });

  const doneSec = sessionActiveSec({ blockResults: results });

  return (
    <>
      <section className="nh-surface-ink rounded-3xl p-5 text-white">
        <div className="flex items-center justify-between text-[11px] font-extrabold tracking-[0.16em] text-white/50 uppercase">
          <span>{t("Blok {n} dari {total}", { n: block.order, total })}</span>
          <span className="inline-flex items-center gap-1">
            <Timer size={12} /> {formatDuration(doneSec + clock.elapsedSec)}
          </span>
        </div>
        <p className="nh-display mt-3 text-3xl leading-tight">
          {block.kind === "RUN" && !block.originalExerciseId ? t("Lari") : block.exerciseName}
        </p>
        <p className="text-sm text-white/60">{[blockVolume(block), block.weightNote].filter(Boolean).join(" · ")}</p>
        <p
          className={`nh-display mt-5 text-6xl tabular-nums ${clock.elapsedSec > block.targetSec ? "text-nh-warn" : "text-nh-lime"}`}
          aria-live="off"
        >
          {formatDuration(clock.elapsedSec)}
        </p>
        <p className="text-xs text-white/50">
          {t("target {time}", { time: formatDuration(block.targetSec) })}
          {paused && ` · ${t("dijeda")}`}
        </p>
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={results.length}
          aria-label={t("Kemajuan workout")}
        >
          <span className="block h-full rounded-full bg-nh-lime" style={{ width: `${sessionCompletionPct({ blockResults: results }, total)}%` }} />
        </div>
      </section>

      {act.error && <ErrorNote>{act.error.message}</ErrorNote>}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
        <button
          type="button"
          className="nh-btn-ghost"
          disabled={act.isPending}
          onClick={() => {
            if (paused) clock.resume();
            else clock.pause();
            act.mutate({ action: paused ? "resume" : "pause" });
          }}
        >
          {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? t("Lanjut") : t("Jeda")}
        </button>
        <button type="button" className="nh-btn-brand" disabled={act.isPending || paused} onClick={finishBlock}>
          <Check size={16} /> {block.order >= total ? t("Selesai workout") : t("Selesai blok")}
        </button>
      </div>

      {next && (
        <p className="text-center text-xs text-nh-muted">
          {t("Berikutnya")}: <span className="font-bold text-nh-ink">{next.kind === "RUN" && !next.originalExerciseId ? t("Lari") : next.exerciseName}</span>{" "}
          {blockVolume(next)}
        </p>
      )}

      <button type="button" className="mx-auto inline-flex items-center gap-1.5 text-xs font-bold text-nh-danger" onClick={stop} disabled={act.isPending}>
        <Square size={12} /> {t("Berhenti dan simpan sebagai parsial")}
      </button>

      <BlockList workout={workout} results={results} />
    </>
  );
}

/* ── Ringkasan ───────────────────────────────────────────────────────── */

function Summary({
  workout,
  session,
  onNew,
  onOpenRaces,
}: {
  workout: WorkoutView;
  session: WorkoutSessionView;
  onNew: () => void;
  onOpenRaces?: () => void;
}) {
  const t = useT();
  const delta = session.active_sec - workout.total_target_sec;
  const completed = session.status === "completed";
  return (
    <>
      <section className={`${completed ? "nh-surface-brand" : "nh-card"} rounded-3xl p-5`}>
        <p className="text-[11px] font-extrabold tracking-[0.16em] uppercase opacity-60">
          {completed ? t("Workout selesai") : t("Disimpan sebagai parsial")}
        </p>
        <p className="nh-display mt-2 text-5xl tabular-nums">{formatDuration(session.active_sec)}</p>
        <p className="mt-1 text-sm">
          {completed
            ? delta <= 0
              ? t("{time} lebih cepat dari target", { time: formatDuration(-delta) })
              : t("{time} di atas target", { time: formatDuration(delta) })
            : t("{n} dari {total} blok tercatat", { n: session.block_results.length, total: workout.blocks.length })}
          {session.pause_count > 0 && ` · ${t("{n}× jeda", { n: session.pause_count })}`}
        </p>
      </section>
      <BlockList workout={workout} results={session.block_results} />
      <div className="flex gap-3">
        {completed && workout.type === "FULL_SIMULATION" && onOpenRaces && (
          <button type="button" className="nh-btn-ghost flex-1" onClick={onOpenRaces}>
            {t("Lihat prediksi race")}
          </button>
        )}
        <button type="button" className="nh-btn-brand flex-1" onClick={onNew}>
          {t("Workout baru")}
        </button>
      </div>
    </>
  );
}
