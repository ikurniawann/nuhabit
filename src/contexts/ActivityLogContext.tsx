"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { ActivityLog, ActivityLogState } from "@/types/activity-log";
import { STORAGE_KEYS, readStorage, writeStorage } from "@/lib/storage-keys";

const MAX_LOGS = 100;
const EMPTY: ActivityLog[] = [];

/**
 * Log aktivitas per browser (localStorage). Store eksternal kecil supaya
 * render server (selalu kosong) dan klien tidak bentrok saat hidrasi.
 */
let cache: ActivityLog[] | null = null;
const listeners = new Set<() => void>();

function load(): ActivityLog[] {
  try {
    const raw = readStorage(STORAGE_KEYS.activityLogs);
    return raw ? (JSON.parse(raw) as ActivityLog[]) : EMPTY;
  } catch (error) {
    console.error("Failed to load activity logs:", error);
    return EMPTY;
  }
}

const getSnapshot = () => (cache ??= load());
const getServerSnapshot = () => EMPTY;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: (prev: ActivityLog[]) => ActivityLog[]) {
  cache = next(getSnapshot());
  writeStorage(STORAGE_KEYS.activityLogs, JSON.stringify(cache));
  listeners.forEach((listener) => listener());
}

const ActivityLogContext = createContext<ActivityLogState | undefined>(undefined);

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const logs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const value = useMemo<ActivityLogState>(
    () => ({
      logs,
      unreadCount: logs.filter((log) => !log.isRead).length,
      addLog: (log) =>
        update((prev) =>
          [{ ...log, id: crypto.randomUUID(), timestamp: new Date().toISOString(), isRead: false }, ...prev].slice(
            0,
            MAX_LOGS
          )
        ),
      markAsRead: (id) => update((prev) => prev.map((log) => (log.id === id ? { ...log, isRead: true } : log))),
      markAllAsRead: () => update((prev) => prev.map((log) => ({ ...log, isRead: true }))),
      clearAll: () => update(() => []),
      clearOlderThan: (days) => {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        update((prev) => prev.filter((log) => new Date(log.timestamp).getTime() > cutoff));
      },
    }),
    [logs]
  );

  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>;
}

export function useActivityLog() {
  const context = useContext(ActivityLogContext);
  if (context === undefined) {
    throw new Error("useActivityLog must be used within ActivityLogProvider");
  }
  return context;
}
