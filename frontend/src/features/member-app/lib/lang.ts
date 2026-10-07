"use client";

import { useSyncExternalStore } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";

/**
 * Member app language, stored per device in localStorage. Every component
 * that uses useT() re-renders when the language changes, with no provider:
 * a small store plus useSyncExternalStore. English by default; a stored
 * "id" keeps Indonesian.
 */
export type Lang = "id" | "en";

const DEFAULT_LANG: Lang = "en";

const listeners = new Set<() => void>();
/** Fallback when localStorage is unavailable (private mode and the like). */
let memoryLang: Lang = DEFAULT_LANG;

const parseLang = (value: unknown): Lang => (value === "id" ? "id" : "en");

function readLang(): Lang {
  return parseLang(readStorage(STORAGE_KEYS.memberLang) ?? memoryLang);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setLang(lang: Lang) {
  memoryLang = lang;
  writeStorage(STORAGE_KEYS.memberLang, lang);
  document.documentElement.lang = lang;
  listeners.forEach((listener) => listener());
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => DEFAULT_LANG);
}
