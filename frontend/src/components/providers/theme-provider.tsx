"use client";

import * as React from "react";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceTokens,
  DEFAULT_APPEARANCE,
  parseAppearanceTokens,
  readCachedAppearance,
  writeCachedAppearance,
  type AppearanceTokens,
} from "@/lib/theme/appearance-tokens";
import {
  applyThemeState,
  DEFAULT_THEME_STATE,
  parseThemeState,
  serializeThemeState,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemeState,
} from "@/lib/theme/theme-state";

type ThemeContextValue = {
  state: ThemeState;
  appearance: AppearanceTokens;
  setState: (next: ThemeState) => void;
  setMode: (mode: ThemeMode) => void;
  applyAppearance: (tokens: AppearanceTokens) => void;
  reset: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

type ThemeSnapshot = { state: ThemeState; appearance: AppearanceTokens };

const SERVER_SNAPSHOT: ThemeSnapshot = { state: DEFAULT_THEME_STATE, appearance: DEFAULT_APPEARANCE };

/**
 * Tema & appearance tersimpan di localStorage. Dibaca lewat
 * useSyncExternalStore: render server/hidrasi memakai default, lalu klien
 * langsung memakai nilai tersimpan tanpa setState di effect.
 */
const themeListeners = new Set<() => void>();
let snapshotCache: { themeRaw: string | null; appearanceRaw: string | null; snapshot: ThemeSnapshot } | null =
  null;

function subscribeTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function readThemeSnapshot(): ThemeSnapshot {
  const themeRaw = window.localStorage.getItem(THEME_STORAGE_KEY);
  const appearanceRaw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  if (
    !snapshotCache ||
    snapshotCache.themeRaw !== themeRaw ||
    snapshotCache.appearanceRaw !== appearanceRaw
  ) {
    snapshotCache = {
      themeRaw,
      appearanceRaw,
      snapshot: { state: parseThemeState(themeRaw), appearance: readCachedAppearance() },
    };
  }
  return snapshotCache.snapshot;
}

function persistTheme(next: Partial<ThemeSnapshot>) {
  if (next.state) window.localStorage.setItem(THEME_STORAGE_KEY, serializeThemeState(next.state));
  if (next.appearance) writeCachedAppearance(next.appearance);
  themeListeners.forEach((listener) => listener());
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { state, appearance } = React.useSyncExternalStore(
    subscribeTheme,
    readThemeSnapshot,
    () => SERVER_SNAPSHOT
  );

  React.useEffect(() => {
    applyThemeState(document.documentElement, state);
  }, [state]);

  React.useEffect(() => {
    applyAppearanceTokens(document.documentElement, appearance);
  }, [appearance]);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/appearance")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.data?.theme) return;
        persistTheme({ appearance: parseAppearanceTokens(json.data.theme) });
      })
      .catch(() => {
        /* guest / 401 — tetap pakai cache */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = React.useCallback((next: ThemeState) => persistTheme({ state: next }), []);

  const applyAppearance = React.useCallback((tokens: AppearanceTokens) => {
    const next = parseAppearanceTokens(tokens);
    persistTheme({
      appearance: next,
      state: {
        ...readThemeSnapshot().state,
        presetId: next.presetId,
        customPrimary: null,
        customSecondary: null,
      },
    });
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      state,
      appearance,
      setState: commit,
      setMode: (mode) => commit({ ...state, mode }),
      applyAppearance,
      reset: () => {
        commit(DEFAULT_THEME_STATE);
        applyAppearance(DEFAULT_APPEARANCE);
      },
    }),
    [state, appearance, commit, applyAppearance]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeOrNull(): ThemeContextValue | null {
  return React.useContext(ThemeContext);
}

export function useTheme(): ThemeContextValue {
  const ctx = useThemeOrNull();
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
