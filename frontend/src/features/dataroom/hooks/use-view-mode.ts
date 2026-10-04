"use client";

import { useSyncExternalStore } from "react";

export type ViewMode = "grid" | "list";

// Mode tampilan disimpan di localStorage; dibaca lewat external store agar
// render server (grid) dan klien tetap konsisten tanpa setState di effect.
const STORAGE_KEY = "dataroom:view";
const listeners = new Set<() => void>();

function read(): ViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function write(mode: ViewMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* abaikan */
  }
  listeners.forEach((callback) => callback());
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const view = useSyncExternalStore(subscribe, read, () => "grid" as ViewMode);
  return [view, write];
}
