"use client";

import { useEffect, useRef } from "react";
import {
  postInterviewProctorEvent,
  postInterviewLiveFrame,
  fetchInterviewWebrtcOffers,
  postInterviewWebrtcAnswer,
} from "../api";
import { startWebrtcAnswerLoop } from "@/lib/recruitment/webrtc-client";

const SNAPSHOT_INTERVAL_MS = 60_000;
/** Frame near-live utk Live Monitoring HRD (lebih sering dari snapshot bukti). */
const LIVE_FRAME_INTERVAL_MS = 4_000;
const FACE_CHECK_INTERVAL_MS = 8_000;
/** Jeda minimal antar event wajah sejenis — jangan banjiri rate limit. */
const FACE_EVENT_COOLDOWN_MS = 30_000;
const SNAPSHOT_WIDTH = 320;
const SNAPSHOT_HEIGHT = 240;
const SNAPSHOT_QUALITY = 0.5;

interface DetectedFace {
  boundingBox: DOMRectReadOnly;
}
interface FaceDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedFace[]>;
}
declare global {
  interface Window {
    FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;
  }
}

/**
 * Proctoring interview AI:
 * - Flag perilaku: pindah tab, keluar fullscreen, paste, koneksi putus
 *   (pola sama dgn psikotes).
 * - Kamera WAJIB: stream dimiliki halaman (self-view + rekaman); hook ini
 *   memakai stream yang sama utk snapshot berkala + deteksi wajah.
 * - Deteksi wajah (Shape Detection API bila tersedia — Chrome):
 *   face_not_detected (keluar frame), multiple_faces (>1 wajah). Event
 *   dikirim saat TRANSISI (debounce + cooldown), bukan tiap interval.
 * - camera_off: track video berakhir/mati.
 * Semua pengiriman fire-and-forget: kegagalan tidak mengganggu interview.
 */
export function useInterviewProctoring(
  token: string,
  active: boolean,
  stream: MediaStream | null
) {
  const offlineSinceRef = useRef<number | null>(null);

  // ── Flag perilaku (tab/fullscreen/paste/offline) ─────────────────────
  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.hidden) postInterviewProctorEvent(token, "tab_blur");
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) postInterviewProctorEvent(token, "fullscreen_exit");
    };
    const onPaste = () => postInterviewProctorEvent(token, "paste");
    const onOffline = () => {
      offlineSinceRef.current = Date.now();
    };
    const onOnline = () => {
      const since = offlineSinceRef.current;
      offlineSinceRef.current = null;
      postInterviewProctorEvent(token, "disconnect", {
        meta: since ? { offline_seconds: Math.round((Date.now() - since) / 1000) } : undefined,
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("paste", onPaste);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [token, active]);

  // ── Snapshot + deteksi wajah + kamera mati ───────────────────────────
  useEffect(() => {
    if (!active || !stream) return;

    let snapshotTimer: ReturnType<typeof setInterval> | null = null;
    let faceTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);

    const canvas = document.createElement("canvas");
    canvas.width = SNAPSHOT_WIDTH;
    canvas.height = SNAPSHOT_HEIGHT;
    const ctx = canvas.getContext("2d");

    const capture = (meta?: Record<string, string | number | boolean>) => {
      if (cancelled || !ctx || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
      const snapshot = canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY);
      postInterviewProctorEvent(token, "webcam_snapshot", { snapshot, meta });
    };
    capture();
    snapshotTimer = setInterval(() => capture(), SNAPSHOT_INTERVAL_MS);

    // frame near-live utk Live Monitoring (UPSERT di server, bukan arsip)
    const sendLiveFrame = () => {
      if (cancelled || !ctx || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
      postInterviewLiveFrame(token, canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY));
    };
    const liveTimer = setInterval(sendLiveFrame, LIVE_FRAME_INTERVAL_MS);

    // video smooth real-time: jawab offer WebRTC dari Live Monitoring HRD
    const stopWebrtc = startWebrtcAnswerLoop({
      stream,
      fetchOffers: () => fetchInterviewWebrtcOffers(token),
      postAnswer: (offerId, sdp) => postInterviewWebrtcAnswer(token, offerId, sdp),
    });

    // camera_off: track video berakhir (kandidat mencabut/mematikan kamera)
    const videoTrack = stream.getVideoTracks()[0] ?? null;
    const onTrackEnded = () => postInterviewProctorEvent(token, "camera_off");
    videoTrack?.addEventListener("ended", onTrackEnded);

    // Deteksi wajah bila browser mendukung Shape Detection API.
    const FaceDetectorCtor = typeof window !== "undefined" ? window.FaceDetector : undefined;
    if (FaceDetectorCtor && ctx) {
      let detector: FaceDetectorLike | null = null;
      try {
        detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 3 });
      } catch {
        detector = null;
      }
      if (detector) {
        let lastState: "ok" | "none" | "multiple" = "ok";
        let lastSentAt = 0;
        const check = async () => {
          if (cancelled || video.readyState < 2) return;
          try {
            ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
            const faces = await detector.detect(canvas);
            const state: "ok" | "none" | "multiple" =
              faces.length === 0 ? "none" : faces.length > 1 ? "multiple" : "ok";
            const now = Date.now();
            // kirim hanya saat transisi dari kondisi normal + cooldown
            if (state !== "ok" && state !== lastState && now - lastSentAt > FACE_EVENT_COOLDOWN_MS) {
              lastSentAt = now;
              const eventType = state === "none" ? "face_not_detected" : "multiple_faces";
              postInterviewProctorEvent(token, eventType, { meta: { faces: faces.length } });
              // bukti visual momen kejadian — bukan cuma flag
              capture({ trigger: eventType });
            }
            lastState = state;
          } catch {
            // detektor gagal — abaikan, snapshot berkala tetap jadi bukti
          }
        };
        faceTimer = setInterval(() => void check(), FACE_CHECK_INTERVAL_MS);
      }
    }

    return () => {
      cancelled = true;
      if (snapshotTimer) clearInterval(snapshotTimer);
      if (faceTimer) clearInterval(faceTimer);
      clearInterval(liveTimer);
      stopWebrtc();
      videoTrack?.removeEventListener("ended", onTrackEnded);
      video.srcObject = null;
    };
  }, [token, active, stream]);
}

/** Minta fullscreen — harus dipanggil dari gesture user (klik tombol). */
export function requestInterviewFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().catch(() => undefined);
  }
}
