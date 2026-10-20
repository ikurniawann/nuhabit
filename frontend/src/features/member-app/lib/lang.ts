"use client";

import { useSyncExternalStore } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";

/**
 * Member app language. Every component that uses useT() re-renders when the
 * language changes, with no provider: a small store plus
 * useSyncExternalStore. Indonesian by default. The account language (athlete
 * settings) wins on a device that has not seen it yet; a choice made on the
 * device stays until the account value changes.
 */
export type Lang = "id" | "en";

export type AccountLang = "EN" | "ID";

const DEFAULT_LANG: Lang = "id";

const listeners = new Set<() => void>();
/** Fallback when localStorage is unavailable (private mode and the like). */
let memoryLang: Lang = DEFAULT_LANG;

const parseLang = (value: unknown): Lang => (value === "en" ? "en" : "id");

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

/**
 * Applies the account language when it differs from the value this device
 * last saw, so a new device follows the account and a later change made on
 * another device reaches this one.
 */
export function syncAccountLang(account: AccountLang) {
  if (readStorage(STORAGE_KEYS.memberAccountLang) === account) return;
  writeStorage(STORAGE_KEYS.memberAccountLang, account);
  setLang(account === "EN" ? "en" : "id");
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => DEFAULT_LANG);
}
