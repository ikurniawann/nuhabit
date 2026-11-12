"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, CameraOff, Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";

/**
 * Dialog selfie absensi: kamera depan via getUserMedia, bingkai potret 3:4
 * dengan panduan wajah. Tampilan langsung dicerminkan seperti cermin, foto
 * yang disimpan tidak (sesuai wajah asli). Yang tersimpan sama persis dengan
 * isi bingkai: potongan tengah video 3:4, JPEG 480×640. Foto wajib: tanpa
 * kamera, absen tidak bisa dilakukan (fallback: koreksi manual oleh HRD).
 */

interface CameraCaptureProps {
  open: boolean;
  title?: string;
  onConfirm: (photoDataUrl: string) => void;
  onCancel: () => void;
}

const CAPTURE_WIDTH = 480;
const CAPTURE_HEIGHT = 640;
const JPEG_QUALITY = 0.8;

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Akses kamera ditolak. Izinkan kamera lewat ikon gembok di bilah alamat browser, lalu tekan Coba Lagi.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Kamera tidak ditemukan di perangkat ini. Gunakan HP atau laptop yang memiliki kamera.";
    case "NotReadableError":
    case "AbortError":
      return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut, lalu tekan Coba Lagi.";
    default:
      return "Kamera tidak dapat dibuka. Periksa izin kamera di browser, lalu tekan Coba Lagi.";
  }
}

function requestCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error("unsupported"));
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false,
  });
}

export function CameraCapture({ open, title = "Ambil Foto Selfie", onConfirm, onCancel }: CameraCaptureProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogPanel
        size="xs"
        className="max-w-[calc(100%-2rem)]"
        style={{
          ["--dialog-panel-max-height" as string]:
            "calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
        }}
      >
        <DialogPanelHeader className="border-border">
          <DialogPanelTitle className="flex items-center gap-2">
            <Camera className="size-5 text-muted-foreground" aria-hidden /> {title}
          </DialogPanelTitle>
          <DialogPanelDescription>Foto wajib. Tanpa foto, absen tidak dapat dilakukan.</DialogPanelDescription>
        </DialogPanelHeader>
        {/* Sesi kamera di-mount ulang tiap dialog dibuka: state foto/error otomatis bersih. */}
        {open && <CameraSession onConfirm={onConfirm} onCancel={onCancel} />}
      </DialogPanel>
    </Dialog>
  );
}

type SessionState =
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "captured"; photo: string }
  | { kind: "error"; message: string };

function CameraSession({ onConfirm, onCancel }: Omit<CameraCaptureProps, "open" | "title">) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const [state, setState] = useState<SessionState>({ kind: "starting" });

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const openStream = useCallback(() => {
    requestCamera().then(
      (stream) => {
        // Dialog sudah ditutup sebelum izin kamera selesai: lepas lagi.
        if (!activeRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
      },
      (error: unknown) => {
        if (activeRef.current) setState({ kind: "error", message: cameraErrorMessage(error) });
      }
    );
  }, []);

  useEffect(() => {
    activeRef.current = true;
    openStream();
    return () => {
      activeRef.current = false;
      stopStream();
    };
  }, [openStream, stopStream]);

  function restart() {
    stopStream();
    setState({ kind: "starting" });
    openStream();
  }

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Potongan tengah 3:4, sama dengan object-cover pada bingkai.
    const { videoWidth: vw, videoHeight: vh } = video;
    const ratio = CAPTURE_WIDTH / CAPTURE_HEIGHT;
    const sw = Math.min(vw, vh * ratio);
    const sh = sw / ratio;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Saved mirrored, as the preview shows it and as HR has always seen selfies.
    ctx.translate(CAPTURE_WIDTH, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    setState({ kind: "captured", photo: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
    stopStream();
  }

  const showVideo = state.kind === "starting" || state.kind === "live";

  return (
    <>
      <DialogPanelBody scroll={false} className="flex flex-col items-center gap-3 px-4 sm:px-6">
        {/* Lebar bingkai dibatasi tinggi layar agar dialog tidak pernah perlu digulir. */}
        <div className="relative aspect-[3/4] w-[min(100%,calc((100dvh-17rem)*0.75))] min-w-40 overflow-hidden rounded-2xl bg-ink">
          {showVideo && (
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Tampilan kamera depan"
              onPlaying={() => setState((s) => (s.kind === "starting" ? { kind: "live" } : s))}
              className="absolute inset-0 size-full -scale-x-100 object-cover"
            />
          )}

          {state.kind === "captured" && (
            <Image
              src={state.photo}
              alt="Pratinjau foto selfie"
              width={CAPTURE_WIDTH}
              height={CAPTURE_HEIGHT}
              unoptimized
              className="absolute inset-0 size-full object-cover duration-200 animate-in fade-in-0"
            />
          )}

          {state.kind === "live" && (
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[62%] w-[58%] rounded-[50%] border-2 border-dashed border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]" />
            </div>
          )}

          {state.kind === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span role="status">Menyalakan kamera…</span>
            </div>
          )}

          {state.kind === "error" && (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-danger-soft p-6 text-center text-sm leading-5 text-danger"
            >
              <CameraOff className="size-8" aria-hidden />
              <p>{state.message}</p>
            </div>
          )}
        </div>

        {state.kind !== "error" && (
          <p className="text-center text-xs text-muted-foreground" aria-live="polite">
            {state.kind === "captured"
              ? "Pastikan wajah terlihat jelas dan tidak buram."
              : "Posisikan wajah di dalam bingkai, lalu tekan Ambil Foto."}
          </p>
        )}
      </DialogPanelBody>

      <DialogFooter className="grid grid-cols-2 gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:px-6 sm:py-4">
        {state.kind === "captured" ? (
          <>
            <Button variant="outline" className="h-11" onClick={restart}>
              <RefreshCw aria-hidden /> Ulangi
            </Button>
            <Button autoFocus className="h-11" onClick={() => onConfirm(state.photo)}>
              <Check aria-hidden /> Gunakan Foto Ini
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="h-11" onClick={onCancel}>
              <X aria-hidden /> Batal
            </Button>
            {state.kind === "error" ? (
              <Button autoFocus className="h-11" onClick={restart}>
                <RefreshCw aria-hidden /> Coba Lagi
              </Button>
            ) : (
              <Button autoFocus className="h-11" disabled={state.kind !== "live"} onClick={handleCapture}>
                <Camera aria-hidden /> Ambil Foto
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
}
