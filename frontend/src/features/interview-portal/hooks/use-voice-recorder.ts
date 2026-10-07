"use client";

import { useEffect, useRef, useState } from "react";

const MAX_RECORD_MS = 3 * 60 * 1000;

export type VoiceRecorderProblem = "no-mic" | "unsupported";

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

/** Timer durasi rekam (tick 500 ms); mengembalikan fungsi penghenti. */
function startElapsedTimer(onTick: (elapsedMs: number) => void): () => void {
  const startedAt = Date.now();
  const id = setInterval(() => onTick(Date.now() - startedAt), 500);
  return () => clearInterval(id);
}

/**
 * Rekam jawaban suara dari track audio stream kamera (maks 3 menit, lalu
 * berhenti otomatis). Blob hasil diserahkan ke `onRecorded` saat berhenti.
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopTimerRef.current?.(), []);

  const start = (stream: MediaStream, onRecorded: (blob: Blob) => void): VoiceRecorderProblem | null => {
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return "no-mic";
    try {
      const mime = pickRecorderMime();
      const recorder = new MediaRecorder(
        new MediaStream(audioTracks),
        mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stopTimerRef.current?.();
        stopTimerRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 0) onRecorded(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordMs(0);
      stopTimerRef.current = startElapsedTimer((elapsed) => {
        setRecordMs(elapsed);
        if (elapsed >= MAX_RECORD_MS) recorderRef.current?.stop();
      });
      return null;
    } catch {
      return "unsupported";
    }
  };

  const stop = () => recorderRef.current?.stop();

  return { recording, recordMs, start, stop };
}
