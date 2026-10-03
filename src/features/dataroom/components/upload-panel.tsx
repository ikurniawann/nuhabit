"use client";

import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { formatBytes } from "@/lib/dataroom/config";
import type { UploadTask } from "@/features/dataroom/hooks/use-upload-queue";

export function UploadPanel({ tasks, onClear }: { tasks: UploadTask[]; onClear: () => void }) {
  if (tasks.length === 0) return null;
  const running = tasks.filter((t) => t.status === "queued" || t.status === "uploading").length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-card shadow-2xl">
      <div className="flex items-center justify-between bg-muted/60 px-3 py-2 text-sm font-medium">
        <span>{running > 0 ? `Mengunggah ${running} file…` : `${tasks.length} unggahan selesai`}</span>
        <button type="button" onClick={onClear} className="rounded p-1 hover:bg-muted" aria-label="Tutup">
          <X className="h-4 w-4" />
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto divide-y">
        {tasks.map((t) => (
          <li key={t.id} className="px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              {t.status === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                : t.status === "error" ? <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              <span className="flex-1 truncate font-medium" title={t.name}>{t.name}</span>
              <span className="text-muted-foreground">{formatBytes(t.size)}</span>
            </div>
            {t.status === "uploading" && (
              <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${t.progress}%` }} />
              </div>
            )}
            {t.status === "error" && <p className="mt-1 text-destructive">{t.error}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
