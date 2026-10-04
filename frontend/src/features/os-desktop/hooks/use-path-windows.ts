"use client";

import { useEffect, useState } from "react";
import { DEEP_LINK_PARAM, DEEP_LINK_TITLE_PARAM, parseDeepLink } from "@/lib/desktop/deep-link";

/** Jendela yang dibuka dari deep link / hasil Spotlight (bisa banyak sekaligus). */
export type PathWindow = { id: string; title: string; path: string };

function newPathWindow(path: string, title: string, index: number): PathWindow {
  return { id: `path:${path}:${index}:${Math.random().toString(36).slice(2, 7)}`, title, path };
}

function windowsFromDeepLink(): PathWindow[] {
  const target = parseDeepLink(new URLSearchParams(window.location.search));
  return target ? [newPathWindow(target.path, target.title, 0)] : [];
}

/**
 * Jendela halaman dashboard (hasil Spotlight, panel Hari Ini, deep link
 * /os?open=/dashboard/...). Id unik per instans → halaman yang sama boleh
 * dibuka dua kali, seperti desktop sungguhan; path yang sudah terbuka difokuskan.
 */
export function usePathWindows(focus: (id: string) => void) {
  const [windows, setWindows] = useState<PathWindow[]>(windowsFromDeepLink);

  /* Parameter deep link dibersihkan supaya refresh tidak menumpuk jendela. */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!parseDeepLink(url.searchParams)) return;
    url.searchParams.delete(DEEP_LINK_PARAM);
    url.searchParams.delete(DEEP_LINK_TITLE_PARAM);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const open = (path: string, title: string) => {
    const existing = windows.find((win) => win.path === path);
    if (existing) focus(existing.id);
    else setWindows((prev) => [...prev, newPathWindow(path, title, prev.length)]);
  };

  const close = (id: string) => setWindows((prev) => prev.filter((win) => win.id !== id));

  return { windows, open, close };
}
