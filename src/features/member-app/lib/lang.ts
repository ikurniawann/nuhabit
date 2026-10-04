"use client";

import { useSyncExternalStore } from "react";

/**
 * Bahasa aplikasi member, disimpan per perangkat di localStorage. Semua
 * komponen yang memakai useT() ikut berganti saat bahasa diubah, tanpa
 * provider: store kecil + useSyncExternalStore. Default Indonesia.
 */
export type Lang = "id" | "en";

const STORAGE_KEY = "bcd-member-lang";
const listeners = new Set<() => void>();
/** Cadangan bila localStorage tidak bisa dipakai (mode privat dsb.). */
let memoryLang: Lang = "id";

const parseLang = (value: unknown): Lang => (value === "en" ? "en" : "id");

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
