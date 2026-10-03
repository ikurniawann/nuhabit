"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseLang, translate, type Lang, type TranslateVars } from "@/lib/member-portal/i18n";

/**
 * Bahasa portal member, disimpan per perangkat di localStorage. Semua
 * komponen yang memakai useT() ikut berganti saat bahasa diubah, tanpa
 * provider: store kecil + useSyncExternalStore.
 */

const STORAGE_KEY = "bcd-member-lang";
const listeners = new Set<() => void>();
/** Cadangan bila localStorage tidak bisa dipakai (mode privat dsb.). */
let memoryLang: Lang = "id";

function readLang(): Lang {
  try {
    return parseLang(window.localStorage.getItem(STORAGE_KEY) ?? memoryLang);
  } catch {
    return memoryLang;
  }
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
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* mode privat: bahasa berganti untuk halaman ini saja */
  }
  document.documentElement.lang = lang;
  listeners.forEach((listener) => listener());
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => "id");
}

export type T = (key: string, vars?: TranslateVars) => string;

export function useT(): T {
  const lang = useLang();
  return useCallback((key: string, vars?: TranslateVars) => translate(lang, key, vars), [lang]);
}

/** Locale tanggal/waktu yang sesuai bahasa portal. */
export const useLocale = () => (useLang() === "en" ? "en-GB" : "id-ID");
