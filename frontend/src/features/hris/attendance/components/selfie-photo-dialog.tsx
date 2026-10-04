"use client";

import Image from "next/image";
import { useState } from "react";
import { Camera, ImageOff, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Selfie absensi ditampilkan dalam modal — permintaan owner 2026-08-27:
 * sebelumnya foto dibuka lewat window.open sehingga HRD berpindah tab dan
 * kehilangan posisi filter/halaman rekap yang sedang dibuka.
 */
export interface SelfiePhotoDialogProps {
  /** Path relatif foto dari API; null = tidak ada selfie. */
  path: string | null;
  /** "masuk" | "pulang" — dipakai di judul modal & tooltip. */
  label: string;
  /** Nama karyawan, bila diketahui pemanggil (tampil di modal). */
  employeeName?: string | null;
  /** Waktu absen terkait, sudah diformat pemanggil. */
  time?: string | null;
  /** Tampilkan teks label di samping ikon (dipakai tab monitoring). */
  showLabel?: boolean;
  /** Placeholder saat tidak ada foto; default: tanda strip. */
  emptyFallback?: React.ReactNode;
  className?: string;
}

export function SelfiePhotoDialog({
  path,
  label,
  employeeName,
  time,
  showLabel = false,
  emptyFallback = <span className="text-gray-300">—</span>,
  className,
}: SelfiePhotoDialogProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!path) return <>{emptyFallback}</>;

  const src = `/api/hris/attendance/photo/${path}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLoaded(false);
          setFailed(false);
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center gap-0.5 text-blue-600 hover:underline",
          showLabel ? "text-xs" : "",
          className
        )}
        title={`Lihat selfie ${label}`}
      >
        <Camera className={showLabel ? "h-3 w-3" : "h-3.5 w-3.5"} />
        {showLabel ? label : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Selfie {label}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {[employeeName?.trim(), time?.trim()].filter(Boolean).join(" — ") ||
                "Foto absensi karyawan"}
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody>
            <div className="relative flex min-h-[16rem] items-center justify-center overflow-hidden rounded-xl border border-gray-200/70 bg-muted/40">
              {!loaded && !failed ? (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Memuat foto…
                </span>
              ) : null}

              {failed ? (
                <span className="inline-flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
                  <ImageOff className="h-6 w-6" />
                  Foto tidak dapat dimuat
                </span>
              ) : (
                // Foto absensi disajikan API internal ber-auth; ukurannya
                // bebas (kamera ponsel) sehingga dibatasi tinggi maksimum.
                <Image
                  src={src}
                  alt={`Selfie ${label}${employeeName ? ` — ${employeeName}` : ""}`}
                  width={900}
                  height={1200}
                  unoptimized
                  onLoad={() => setLoaded(true)}
                  onError={() => {
                    setFailed(true);
                    setLoaded(true);
                  }}
                  className={cn(
                    "max-h-[65vh] w-auto object-contain",
                    loaded ? "opacity-100" : "opacity-0"
                  )}
                />
              )}
            </div>
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>
    </>
  );
}
