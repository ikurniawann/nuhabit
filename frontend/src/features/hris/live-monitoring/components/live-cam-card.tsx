"use client";

import { useEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { startWebrtcViewer } from "@/lib/recruitment/webrtc-client";
import { fetchWebrtcAnswer, liveFrameUrl, postWebrtcOffer, type LiveSessionType } from "../api";

const FRAME_REFRESH_MS = 3_000;

type RtcStatus = "connecting" | "connected" | "failed";

const STATUS_LABEL: Record<RtcStatus, string> = {
  connected: "LIVE · video real-time",
  connecting: "Menghubungkan video langsung…",
  failed: "Mode frame (video langsung gagal)",
};

/** Live cam: video WebRTC real-time; gagal → fallback frame polling 3 dtk. */
export function LiveCamCard({ type, sessionId }: { type: LiveSessionType; sessionId: string }) {
  const [tick, setTick] = useState(0);
  const [frameFailed, setFrameFailed] = useState(false);
  const [rtcStatus, setRtcStatus] = useState<RtcStatus>("connecting");
  const [rtcAttempt, setRtcAttempt] = useState(0);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(
    () =>
      startWebrtcViewer({
        postOffer: (offerId, sdp) => postWebrtcOffer(type, sessionId, offerId, sdp),
        fetchAnswer: (offerId) => fetchWebrtcAnswer(type, sessionId, offerId),
        onStream: (stream) => {
          if (!videoRef.current) return;
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        },
        onStatus: setRtcStatus,
      }),
    [type, sessionId, rtcAttempt]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setFrameFailed(false);
    }, FRAME_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const live = rtcStatus === "connected";

  return (
    <Card className="overflow-hidden p-0 lg:col-span-2">
      <div className="relative aspect-[4/3] w-full bg-gray-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-contain ${live ? "" : "hidden"}`}
        />
        {!live &&
          (!frameFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={liveFrameUrl(type, sessionId, tick)}
              alt="Live cam kandidat"
              onError={() => setFrameFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-500">
              <VideoOff className="size-10" />
              <p className="text-sm">Belum ada frame — kandidat mungkin baru memulai / kamera off</p>
            </div>
          ))}
        <span
          className={`absolute left-3 top-3 flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold text-white ${
            live ? "bg-red-600" : "bg-gray-700"
          }`}
        >
          <span className={`size-2 rounded-full bg-white ${live ? "animate-pulse" : ""}`} />
          {STATUS_LABEL[rtcStatus]}
        </span>
        <div className="absolute right-3 top-3 flex gap-2">
          {live && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="rounded bg-black/60 px-2 py-1 text-xs font-medium text-white hover:bg-black/80"
            >
              {muted ? "🔇 Aktifkan suara" : "🔊 Suara aktif"}
            </button>
          )}
          {rtcStatus === "failed" && (
            <button
              type="button"
              onClick={() => {
                setRtcStatus("connecting");
                setRtcAttempt((n) => n + 1);
              }}
              className="rounded bg-black/60 px-2 py-1 text-xs font-medium text-white hover:bg-black/80"
            >
              Coba video langsung lagi
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
