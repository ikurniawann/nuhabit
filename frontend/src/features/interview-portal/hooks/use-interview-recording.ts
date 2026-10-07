"use client";

import { useEffect } from "react";
import { postRecordingChunk } from "../api";

const TIMESLICE_MS = 10_000;
const VIDEO_BPS = 400_000;
const AUDIO_BPS = 48_000;

function pickVideoMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

/**
 * Rekaman video interview (EPIC-003): merekam kamera+mikrofon kandidat
 * sepanjang sesi (MediaRecorder, ~450 kbps) dan mengunggah potongan tiap
 * 10 dtk ke storage private — HRD memutar hasilnya dari panel Interview.
 * Upload berurutan (antrean) supaya append server tetap valid; reload
 * halaman memulai part baru. Kegagalan rekaman tidak mengganggu interview.
 */
export function useInterviewRecording(token: string, active: boolean, stream: MediaStream | null) {
  useEffect(() => {
    if (!active || !stream || stream.getVideoTracks().length === 0) return;
    const mime = pickVideoMime();
    if (!mime || !mime.startsWith("video/webm")) return; // append chunked hanya valid utk webm

    let recorder: MediaRecorder | null = null;
    let cancelled = false;
    const part = String(Date.now());
    // antrean upload berurutan — chunk berikutnya menunggu yang sebelumnya
    let uploadQueue: Promise<unknown> = Promise.resolve();

    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      });
      recorder.ondataavailable = (event) => {
        if (cancelled || event.data.size === 0) return;
        const blob = event.data;
        uploadQueue = uploadQueue.then(() => postRecordingChunk(token, part, blob));
      };
      recorder.start(TIMESLICE_MS);
    } catch {
      // perekam tidak didukung — interview tetap berjalan tanpa rekaman video
      return;
    }

    return () => {
      cancelled = false; // biarkan chunk terakhir (flush stop) tetap terkirim
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        // sudah berhenti
      }
    };
  }, [token, active, stream]);
}
