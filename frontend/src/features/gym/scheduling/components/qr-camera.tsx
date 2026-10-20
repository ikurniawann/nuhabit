"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Bagian BarcodeDetector (Shape Detection API) yang dipakai; belum ada di lib DOM TypeScript. */
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

const SCAN_EVERY_MS = 250;
const noSubscription = () => () => {};

/**
 * Pindai QR member dengan kamera perangkat lewat BarcodeDetector bawaan
 * browser. Browser tanpa API itu (Safari lama, Firefox) diarahkan ke scanner
 * USB atau tempel token.
 */
export function QrCamera({ onToken, disabled }: { onToken: (token: string) => void; disabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // false saat render server, lalu dicek di browser.
  const supported = useSyncExternalStore(noSubscription, () => barcodeDetector() !== null, () => false);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!on || disabled || !Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        const [hit] = video.readyState >= 2 ? await detector.detect(video) : [];
        if (hit?.rawValue && !stopped) {
          setOn(false);
          onTokenRef.current(hit.rawValue.trim());
          return;
        }
      } catch {
        // Frame belum siap; coba lagi di putaran berikutnya.
      }
      timer = setTimeout(tick, SCAN_EVERY_MS);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((media) => {
        if (stopped) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          void videoRef.current.play();
        }
        void tick();
      })
      .catch(() => {
        setError("Kamera tidak bisa dibuka. Izinkan akses kamera atau pakai scanner.");
        setOn(false);
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on, disabled]);

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        Browser ini belum mendukung pemindaian kamera. Pakai scanner USB atau tempel token.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setOn((cur) => !cur);
        }}
        disabled={disabled}
      >
        {on ? <CameraOff /> : <Camera />} {on ? "Tutup kamera" : "Pindai dengan kamera"}
      </Button>
      {on && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-square w-full max-w-xs rounded-2xl bg-ink object-cover"
          aria-label="Pratinjau kamera"
        />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
