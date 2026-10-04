"use client";

import { useSyncExternalStore } from "react";
import { isHandheldClient } from "@/lib/pos/thermal-serial";

/** User agent tidak berubah selama sesi → tidak perlu berlangganan apa pun. */
function subscribe(): () => void {
  return () => {};
}

function getSnapshot(): boolean {
  return isHandheldClient();
}

function getServerSnapshot(): boolean {
  return false;
}

/** Hydration-safe: SSR false, then iPad/Android UA after mount. */
export function useHandheldClient(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
