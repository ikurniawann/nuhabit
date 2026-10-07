"use client";

import { useEffect, useEffectEvent, useState } from "react";

const secondsLeft = (endMs: number, nowMs: number) => Math.max(0, Math.floor((endMs - nowMs) / 1000));

/**
 * Sisa detik menuju endsAt (ISO); null bila endsAt null. Berhenti di 0.
 * `onExpire` dipanggil sekali dari tick timer begitu sisa waktu habis.
 */
export function useCountdown(endsAt: string | null, onExpire?: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());
  const expire = useEffectEvent(() => onExpire?.());

  useEffect(() => {
    if (!endsAt) return;
    const endMs = new Date(endsAt).getTime();
    let expired = false;
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (!expired && secondsLeft(endMs, tick) <= 0) {
        expired = true;
        expire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  if (!endsAt) return null;
  return secondsLeft(new Date(endsAt).getTime(), now);
}

export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
