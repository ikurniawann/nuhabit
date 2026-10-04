"use client";

import { useCallback, useSyncExternalStore } from "react";
import { PERIOD_KINDS, type PeriodKind } from "@/lib/desktop/period";
import { STORAGE_KEYS, readStorage, writeStorage } from "@/lib/storage-keys";

/** Pendengar lokal: `storage` hanya menyala di TAB LAIN, tab sendiri perlu ini. */
const periodListeners = new Set<() => void>();

function subscribePeriod(callback: () => void): () => void {
  periodListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    periodListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readPeriod(): PeriodKind {
  const saved = readStorage(STORAGE_KEYS.desktopPeriod);
  return (PERIOD_KINDS as readonly string[]).includes(saved ?? "") ? (saved as PeriodKind) : "today";
}

/**
 * Pilihan periode papan, bertahan antar sesi (EPIC-037 Fase A).
 *
 * `useSyncExternalStore`: snapshot server dikunci ke `today` sehingga tidak
 * ada hydration mismatch, dan membuka papan di dua tab membuat pilihan
 * periodenya ikut serempak lewat event `storage`.
 */
export function usePeriodPreference(): [PeriodKind, (next: PeriodKind) => void] {
  const periode = useSyncExternalStore<PeriodKind>(subscribePeriod, readPeriod, () => "today");

  const pilih = useCallback((next: PeriodKind) => {
    writeStorage(STORAGE_KEYS.desktopPeriod, next);
    periodListeners.forEach((notify) => notify());
  }, []);

  return [periode, pilih];
}
