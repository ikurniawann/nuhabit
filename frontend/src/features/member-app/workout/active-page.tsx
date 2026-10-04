"use client";

import { CheckCircle2, CirclePlay, Pause, Play, Square } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { WorkoutSessionView } from "@/lib/member-app/workout";
import { VideoSheet } from "../components/video-sheet";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { api, useExerciseLibrary, useInvalidateAll } from "../lib/queries-workout";
import { Spinner, formatDuration } from "../ui";
import { BlockLine } from "./preview-page";

/** The active workout screen (blueprint §48): huge timer, one block at a time. */
export function WorkoutActivePage() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const t = useT();
  const invalidate = useInvalidateAll();
  const [view, setView] = useState<WorkoutSessionView | null>(null);
  const [totalSec, setTotalSec] = useState(0);
  const [blockSec, setBlockSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: library } = useExerciseLibrary();

  useEffect(() => {
    void api.workout.session(sessionId).then((loaded) => {
      setView(loaded);
      // Sesi yang dibuka ulang saat dijeda tetap dijeda (server menolak jeda dua kali).
      setPaused(loaded.session.status === "PAUSED");
    });
  }, [sessionId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!paused && view && ["STARTED", "PAUSED"].includes(view.session.status)) {
        setTotalSec((s) => s + 1);
        setBlockSec((s) => s + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [paused, view]);

  if (!view) return <Spinner label={t("Loading session…")} />;
  const { session, workout } = view;
  const done = session.status === "COMPLETED" || session.status === "PARTIAL";
  const currentBlock = workout.blocks.find((b) => b.order === session.currentBlock);
  const currentVideo = currentBlock
    ? (library?.exercises.find((e) => e.id === currentBlock.exerciseId)?.videoUrl ?? null)
    : null;
  const completedCount = session.blockResults.length;
  const pct = Math.round((completedCount / workout.blocks.length) * 100);

  const completeBlock = async () => {
    if (!currentBlock || busy) return;
    setBusy(true);
    try {
      const updated = await api.workout.completeBlock(session.id, currentBlock.order, Math.max(1, blockSec));
      setBlockSec(0);
      if (updated.session.blockResults.length >= workout.blocks.length) {
        const finished = await api.workout.finish(session.id, false);
        setView(finished);
        invalidate();
      } else {
        setView(updated);
      }
    } finally {
      setBusy(false);
    }
  };

  // Lama jeda dihitung server dari paused_at, jadi resume tidak perlu mengirim durasi.
  const togglePause = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (paused) {
        setView(await api.workout.resume(session.id));
        setPaused(false);
      } else {
        setView(await api.workout.pause(session.id));
        setPaused(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const stopAndSave = async () => {
    if (!window.confirm(t("Stop and save this workout as partial?"))) return;
    setBusy(true);
    try {
      const finished = await api.workout.finish(session.id, true);
      setView(finished);
      invalidate();
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center gap-5 pt-6 text-center">
        <CheckCircle2 size={64} className={session.status === "COMPLETED" ? "text-nh-ok" : "text-nh-warn"} />
        <div>
          <h1 className="nh-display text-3xl">
            {session.status === "COMPLETED" ? t("Workout complete") : t("Saved as partial")}
          </h1>
          <p className="mt-1 text-nh-muted">
            {completedCount} / {workout.blocks.length} {t("blocks")} · {view.completionPct}% ·{" "}
            {formatDuration(view.activeSec)} {t("active")}
          </p>
        </div>
        <div className="nh-card w-full text-left">
          <p className="nh-label">{t("Block results")}</p>
          <div className="flex flex-col gap-1.5">
            {session.blockResults.map((r) => {
              const block = workout.blocks.find((b) => b.order === r.order)!;
              return (
                <div key={r.order} className="flex justify-between text-sm">
                  <span className="font-bold">
                    {r.order}. {block.exerciseName}
                  </span>
                  <span className={r.durationSec <= block.targetSec ? "font-black text-nh-ok" : "font-black text-nh-warn"}>
                    {formatDuration(r.durationSec)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <Link href={m("/workout")} className="text-sm font-bold text-nh-forest">
          {t("Back to workouts")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="nh-card flex flex-col items-center !py-6">
        <p className="nh-label !mb-0">{t("Total time")}</p>
        <p className="nh-display text-6xl leading-none">{formatDuration(totalSec)}</p>
        <p className="mt-2 text-xs font-black uppercase tracking-widest text-nh-muted">
          {t("Block")} {completedCount + 1} / {workout.blocks.length}
        </p>
      </div>

      {currentBlock ? (
        <div className="nh-card flex flex-col items-center gap-1 !border-nh-forest !py-6 text-center">
          <p className="nh-display text-3xl">{currentBlock.exerciseName}</p>
          {currentBlock.originalExerciseName ? (
            <p className="text-xs font-bold text-nh-muted">
              {t("substituting")} {currentBlock.originalExerciseName}
            </p>
          ) : null}
          <p className="text-sm font-bold text-nh-muted">
            {currentBlock.distanceM ? `${currentBlock.distanceM} m` : null}
            {currentBlock.reps ? `${currentBlock.reps} ${t("reps")}` : null}
            {currentBlock.weightNote ? ` · ${currentBlock.weightNote}` : ""}
            {` · ${t("target")} `}
            {formatDuration(currentBlock.targetSec)}
          </p>
          <p className="nh-display mt-2 text-5xl text-nh-forest">{formatDuration(blockSec)}</p>
          {currentVideo ? (
            <button className="nh-chip mt-3 bg-nh-forest/10 text-nh-forest" onClick={() => setVideoOpen(true)}>
              <CirclePlay size={13} /> {t("How to perform")}
            </button>
          ) : null}
        </div>
      ) : null}

      <button className="nh-btn-brand !py-4 text-lg" disabled={busy || paused} onClick={() => void completeBlock()}>
        {t("Complete block")}
      </button>
      <div className="grid grid-cols-2 gap-3">
        <button
          className="nh-btn-ghost flex items-center justify-center gap-2"
          disabled={busy}
          onClick={() => void togglePause()}
        >
          {paused ? <Play size={18} /> : <Pause size={18} />}
          {paused ? t("Resume") : t("Pause")}
        </button>
        <button
          className="nh-btn-ghost flex items-center justify-center gap-2 text-nh-danger"
          disabled={busy}
          onClick={() => void stopAndSave()}
        >
          <Square size={16} fill="currentColor" /> {t("Stop & save")}
        </button>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-nh-raised">
        <div className="h-full rounded-full bg-nh-forest transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-center text-xs font-black uppercase tracking-widest text-nh-muted">
        {pct}% {t("complete")}
      </p>

      {videoOpen && currentBlock && currentVideo ? (
        <VideoSheet title={currentBlock.exerciseName} videoUrl={currentVideo} onClose={() => setVideoOpen(false)} />
      ) : null}

      <div className="nh-card">
        <p className="nh-label">{t("Up next")}</p>
        <div className="flex flex-col gap-2 opacity-70">
          {workout.blocks
            .filter((b) => b.order > session.currentBlock)
            .slice(0, 4)
            .map((b) => (
              <BlockLine key={b.order} block={b} />
            ))}
        </div>
      </div>
    </div>
  );
}
