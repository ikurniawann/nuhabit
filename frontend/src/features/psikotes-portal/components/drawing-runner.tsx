"use client";

import { useEffect, useState } from "react";
import { Camera, CheckCircle2, Clock, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { uploadPortalDrawing, finishPortalTest } from "../api";
import { useCountdown, formatCountdown } from "../hooks/use-countdown";
import type { PortalTestStartData } from "../types";

interface DrawingRunnerProps {
  token: string;
  data: PortalTestStartData;
  onFinished: () => void;
}

/**
 * Runner tes gambar (Baum/DAP/Wartegg): kandidat menggambar di kertas,
 * memfoto hasilnya (kamera/file), unggah, lalu selesaikan tes →
 * status perlu_review (dinilai manual HR).
 */
export function DrawingRunner({ token, data, onFinished }: DrawingRunnerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(data.test.has_attachment);
  const [uploading, setUploading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // object URL lama dilepas saat diganti atau komponen dilepas
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pickFile = (next: File | null) => {
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      await uploadPortalDrawing(token, data.test.id, file);
      setUploaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengunggah");
    } finally {
      setUploading(false);
    }
  };

  const handleFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await finishPortalTest(token, data.test.id);
      onFinished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyelesaikan tes");
      setFinishing(false);
    }
  };

  // waktu habis → server menolak upload baru; selesaikan otomatis
  const remaining = useCountdown(data.ends_at, () => void handleFinish());
  const timeUp = remaining !== null && remaining <= 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{data.test.instrument.name}</div>
        {remaining !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
            <Clock className="size-3.5" /> {formatCountdown(remaining)}
          </span>
        )}
      </div>

      {data.test.instrument.instructions && (
        <p className="whitespace-pre-wrap rounded-lg bg-muted/60 px-4 py-3 text-sm">
          {data.test.instrument.instructions}
        </p>
      )}

      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground hover:bg-muted/40">
          <Camera className="size-6" />
          {file ? file.name : "Foto / pilih gambar hasil kerja Anda (JPG, PNG, WebP — maks 8MB)"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- pratinjau blob: lokal, next/image tidak mendukung
          <img
            src={previewUrl}
            alt="Pratinjau hasil gambar"
            className="max-h-72 w-full rounded-lg border border-border object-contain"
          />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleUpload}
            disabled={!file || uploading || timeUp}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Unggah Gambar
          </Button>
          {uploaded && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <CheckCircle2 className="size-4" /> Terunggah
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end border-t border-border pt-3">
        <Button type="button" onClick={handleFinish} disabled={finishing || !uploaded}>
          {finishing && <Loader2 className="size-4 animate-spin" />}
          Selesaikan Tes
        </Button>
      </div>
    </Card>
  );
}
