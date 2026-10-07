"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Dialog selfie absensi: kamera depan via getUserMedia → capture ke canvas
 * (JPEG 640px) → preview + ulangi → konfirmasi. Foto wajib: tanpa kamera,
 * absen tidak bisa dilakukan (fallback: koreksi manual oleh HRD).
 */

interface CameraCaptureProps {
  open: boolean;
  title?: string;
  onConfirm: (photoDataUrl: string) => void;
  onCancel: () => void;
}

const CAPTURE_WIDTH = 640;
const JPEG_QUALITY = 0.8;
const CAMERA_ERROR =
  "Kamera tidak dapat diakses. Izinkan akses kamera di browser, lalu coba lagi. " +
  "Tanpa foto, absen tidak dapat dilakukan.";

function requestCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 } },
    audio: false,
  });
}

export function CameraCapture({ open, title = "Ambil Foto Selfie", onConfirm, onCancel }: CameraCaptureProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>
        {/* Sesi kamera di-mount ulang tiap dialog dibuka: state foto/error otomatis bersih. */}
        {open && <CameraSession onConfirm={onConfirm} onCancel={onCancel} />}
      </DialogContent>
    </Dialog>
  );
}

function CameraSession({ onConfirm, onCancel }: Omit<CameraCaptureProps, "open" | "title">) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const attachStream = useCallback((stream: MediaStream) => {
    // Dialog sudah ditutup sebelum izin kamera selesai: lepas lagi.
    if (!activeRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const openStream = useCallback(() => {
    requestCamera().then(attachStream, () => setError(CAMERA_ERROR));
  }, [attachStream]);

  useEffect(() => {
    activeRef.current = true;
    openStream();
    return () => {
      activeRef.current = false;
      stopStream();
    };
  }, [openStream, stopStream]);

  function restart() {
    setError(null);
    setPhoto(null);
    openStream();
  }

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const scale = CAPTURE_WIDTH / video.videoWidth;
    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // mirror horizontal agar sesuai preview kamera depan
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    stopStream();
  }

  return (
    <>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
      ) : photo ? (
        <Image
          src={photo}
          alt="Preview selfie"
          width={CAPTURE_WIDTH}
          height={CAPTURE_WIDTH}
          unoptimized
          className="h-auto w-full rounded-lg"
        />
      ) : (
        <video ref={videoRef} playsInline muted className="w-full -scale-x-100 rounded-lg bg-black" />
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Batal
        </Button>
        {error ? (
          <Button onClick={restart}>
            <RefreshCw className="mr-1 h-4 w-4" /> Coba Lagi
          </Button>
        ) : photo ? (
          <>
            <Button variant="outline" onClick={restart}>
              <RefreshCw className="mr-1 h-4 w-4" /> Ulangi
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => onConfirm(photo)}>
              <Check className="mr-1 h-4 w-4" /> Gunakan Foto Ini
            </Button>
          </>
        ) : (
          <Button className="bg-green-600 hover:bg-green-700" onClick={handleCapture}>
            <Camera className="mr-1 h-4 w-4" /> Ambil Foto
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
