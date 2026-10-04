"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Tampilan gagal-fetch utk tab logbook — supaya 403/500/jaringan tidak
 * menyaru sebagai empty state ("belum ada data").
 */
export function LogbookQueryError({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : "Gagal memuat data logbook";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
