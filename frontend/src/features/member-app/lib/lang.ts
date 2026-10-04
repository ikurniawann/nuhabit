"use client";

import { useSyncExternalStore } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";

/**
 * Bahasa aplikasi member, disimpan per perangkat di localStorage. Semua
 * komponen yang memakai useT() ikut berganti saat bahasa diubah, tanpa
 * provider: store kecil + useSyncExternalStore. Default Indonesia.
 */
export type Lang = "id" | "en";

const listeners = new Set<() => void>();
/** Cadangan bila localStorage tidak bisa dipakai (mode privat dsb.). */
let memoryLang: Lang = "id";

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

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => "id");
}
