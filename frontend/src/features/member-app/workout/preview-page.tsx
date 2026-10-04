"use client";

import { ArrowLeft, CirclePlay, Footprints, Play, RefreshCcw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { listSubstitutes, type WorkoutBlock } from "@/lib/gym/hyrox";
import { VideoSheet } from "../components/video-sheet";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { api, useExerciseLibrary, useInvalidateAll, useWorkout } from "../lib/queries-workout";
import { Spinner, formatDuration } from "../ui";

export function BlockLine({ block }: { block: WorkoutBlock }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      {block.kind === "RUN" ? (
        <Footprints size={18} className="shrink-0 text-nh-muted" />
      ) : (
        <span className="w-[18px] shrink-0 text-center font-black text-nh-forest">{block.order}</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black">
          {block.exerciseName}
          {block.originalExerciseName ? (
            <span className="ml-1.5 text-xs font-bold text-nh-muted">
              ({t("for")} {block.originalExerciseName})
            </span>
          ) : null}
        </p>
        <p className="text-xs text-nh-muted">
          {block.distanceM ? `${block.distanceM} m` : null}
          {block.reps ? `${block.reps} ${t("reps")}` : null}
          {block.weightNote ? ` · ${block.weightNote}` : ""}
        </p>
      </div>
      <span className="text-sm font-bold text-nh-muted">{formatDuration(block.targetSec)}</span>
    </div>
  );
}

export function WorkoutPreviewPage() {
  const { workoutId = "" } = useParams<{ workoutId: string }>();
  const router = useRouter();
  const t = useT();
  const invalidate = useInvalidateAll();
  const { data: workout, isLoading } = useWorkout(workoutId);
  const { data: library } = useExerciseLibrary();
  const [swapTarget, setSwapTarget] = useState<WorkoutBlock | null>(null);
  const [videoTarget, setVideoTarget] = useState<{ title: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isLoading || !workout) return <Spinner label={t("Loading workout…")} />;

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await api.workout.start(workout.id);
      router.replace(m(`/workout/active/${session.session.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not start."));
    } finally {
      setBusy(false);
    }
  };

  const videoFor = (block: WorkoutBlock) => library?.exercises.find((e) => e.id === block.exerciseId)?.videoUrl ?? null;

  const substitutesFor = (block: WorkoutBlock) =>
    library ? listSubstitutes(block.originalExerciseId ?? block.exerciseId, library.substitutions, library.exercises) : [];

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.push(m("/workout"))} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-nh-muted">{workout.division.replaceAll("_", " ")}</p>
        <h1 className="nh-display text-3xl">{workout.type.replaceAll("_", " ")}</h1>
        <p className="text-sm text-nh-muted">
          {workout.blocks.length} {t("blocks")} · {t("target")} {formatDuration(workout.totalTargetSec)}
        </p>
      </div>

      <div className="nh-card flex flex-col gap-3">
        {workout.blocks.map((block) => (
          <div key={block.order} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <BlockLine block={block} />
            </div>
            {videoFor(block) ? (
              <button
                className="shrink-0 text-nh-muted hover:text-nh-forest"
                aria-label={t("How to perform")}
                onClick={() => setVideoTarget({ title: block.exerciseName, url: videoFor(block)! })}
              >
                <CirclePlay size={16} />
              </button>
            ) : null}
            {block.kind === "STATION" && substitutesFor(block).length > 0 ? (
              <button
                className="shrink-0 text-nh-muted hover:text-nh-forest"
                aria-label={t("Swap exercise")}
                onClick={() => setSwapTarget(block)}
              >
                <RefreshCcw size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      <button
        className="nh-btn-brand flex items-center justify-center gap-2 !py-4 text-lg"
        disabled={busy}
        onClick={() => void start()}
      >
        <Play size={20} fill="currentColor" /> {t("Start workout")}
      </button>

      {videoTarget ? (
        <VideoSheet title={videoTarget.title} videoUrl={videoTarget.url} onClose={() => setVideoTarget(null)} />
      ) : null}
      {swapTarget ? (
        <div
          className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/50"
          onClick={() => setSwapTarget(null)}
        >
          <div className="nh-sheet-panel w-full max-w-md rounded-t-3xl bg-nh-cream p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="nh-display mb-1 text-xl">
              {t("Replace")} {swapTarget.exerciseName}
            </h2>
            <p className="mb-3 text-sm text-nh-muted">{t("Substitutes ranked by similarity.")}</p>
            <div className="flex flex-col gap-2">
              {substitutesFor(swapTarget).map(({ exercise, rule }) => (
                <button
                  key={exercise.id}
                  className="nh-card flex items-center justify-between !py-3 text-left"
                  onClick={async () => {
                    await api.workout.replaceBlock(workout.id, swapTarget.order, exercise.id);
                    setSwapTarget(null);
                    invalidate();
                  }}
                >
                  <div>
                    <p className="font-black">{exercise.name}</p>
                    <p className="text-xs text-nh-muted">{rule.conversionNote}</p>
                  </div>
                  <span className="text-xs font-black text-nh-forest">{Math.round(rule.similarity * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
