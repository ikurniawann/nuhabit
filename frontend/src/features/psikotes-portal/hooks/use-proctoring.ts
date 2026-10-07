"use client";

import { useEffect, useRef } from "react";
import { postProctorEvent, postLiveFrame, fetchWebrtcOffers, postWebrtcAnswer } from "../api";
import { startWebrtcAnswerLoop } from "@/lib/recruitment/webrtc-client";

const SNAPSHOT_INTERVAL_MS = 60_000;
/** Frame near-live utk Live Monitoring HRD (lebih sering dari snapshot bukti). */
const LIVE_FRAME_INTERVAL_MS = 4_000;
const SNAPSHOT_WIDTH = 320;
const SNAPSHOT_HEIGHT = 240;
const SNAPSHOT_QUALITY = 0.5;

/**
 * Proctoring client:
 * - Flag perilaku: pindah tab (visibilitychange), keluar fullscreen, paste,
 *   koneksi putus (offline→online).
 * - Snapshot webcam berkala (hanya bila kandidat consent) — resolusi rendah,
 *   dikirim sbg data URL jpeg ke endpoint proctor-event.
 * Semua pengiriman fire-and-forget: kegagalan tidak mengganggu tes.
 */
export function useProctoring(token: string, active: boolean, webcamConsent: boolean) {
  const offlineSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.hidden) postProctorEvent(token, "tab_blur");
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) postProctorEvent(token, "fullscreen_exit");
    };
    const onPaste = () => postProctorEvent(token, "paste");
    const onOffline = () => {
      offlineSinceRef.current = Date.now();
    };
    const onOnline = () => {
      const since = offlineSinceRef.current;
      offlineSinceRef.current = null;
      postProctorEvent(token, "disconnect", {
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

  useEffect(() => {
    if (!active || !webcamConsent) return;

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let liveTimer: ReturnType<typeof setInterval> | null = null;
    let stopWebrtc: (() => void) | null = null;
    let cancelled = false;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: SNAPSHOT_WIDTH, height: SNAPSHOT_HEIGHT },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement("canvas");
        canvas.width = SNAPSHOT_WIDTH;
        canvas.height = SNAPSHOT_HEIGHT;
        const ctx = canvas.getContext("2d");

        const capture = () => {
          if (!ctx || video.readyState < 2) return;
          ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
          const snapshot = canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY);
          postProctorEvent(token, "webcam_snapshot", { snapshot });
        };

        capture();
        timer = setInterval(capture, SNAPSHOT_INTERVAL_MS);

        // frame near-live (kualitas sama, interval pendek) — UPSERT di server
        const sendLiveFrame = () => {
          if (!ctx || video.readyState < 2) return;
          ctx.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
          postLiveFrame(token, canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY));
        };
        liveTimer = setInterval(sendLiveFrame, LIVE_FRAME_INTERVAL_MS);

        // video smooth real-time: jawab offer WebRTC dari Live Monitoring HRD
        stopWebrtc = startWebrtcAnswerLoop({
          stream,
          fetchOffers: () => fetchWebrtcOffers(token),
          postAnswer: (offerId, sdp) => postWebrtcAnswer(token, offerId, sdp),
        });
      } catch {
        // kamera ditolak/tidak ada — consent sudah terekam, HR melihat tidak ada snapshot
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (liveTimer) clearInterval(liveTimer);
      stopWebrtc?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [token, active, webcamConsent]);
}

/** Minta fullscreen — harus dipanggil dari gesture user (klik tombol). */
export function requestFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().catch(() => undefined);
  }
}
