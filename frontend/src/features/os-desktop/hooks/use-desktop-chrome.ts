"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/** Jam menubar, diperbarui tiap 30 detik. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

const FLOAT_VARS = ["--float-x", "--float-y", "--float-x-reverse", "--float-y-reverse", "--float-x-panel", "--float-y-panel", "--float-x-note", "--float-y-note"];

export const INITIAL_MOTION_STYLE = {
  "--mouse-x": "50%",
  "--mouse-y": "50%",
  ...Object.fromEntries(FLOAT_VARS.map((name) => [name, "0px"])),
} as CSSProperties;

/**
 * Efek parallax wallpaper: posisi mouse ditulis langsung ke CSS variable
 * elemen `ref` (tanpa render ulang React) dan dipakai lapisan latar desktop.
 */
export function useParallax<T extends HTMLElement>(ref: RefObject<T | null>) {
  const onMouseMove = (event: ReactMouseEvent<T>) => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
    const floatX = (xPercent - 50) * 0.42;
    const floatY = (yPercent - 50) * 0.42;
    const values: Record<string, string> = {
      "--mouse-x": `${xPercent}%`,
      "--mouse-y": `${yPercent}%`,
      "--float-x": `${floatX}px`,
      "--float-y": `${floatY}px`,
      "--float-x-reverse": `${floatX * -1}px`,
      "--float-y-reverse": `${floatY * -1}px`,
      "--float-x-panel": `${floatX * 0.35}px`,
      "--float-y-panel": `${floatY * 0.35}px`,
      "--float-x-note": `${floatX * -0.25}px`,
      "--float-y-note": `${floatY * -0.25}px`,
    };
    for (const [name, value] of Object.entries(values)) element.style.setProperty(name, value);
  };

  const onMouseLeave = () => {
    const element = ref.current;
    if (!element) return;
    for (const name of FLOAT_VARS) element.style.setProperty(name, "0px");
    element.style.setProperty("--mouse-x", "50%");
    element.style.setProperty("--mouse-y", "50%");
  };

  return { onMouseMove, onMouseLeave };
}

/** Klik halus ala desktop OS (Sound Effects, default mati). */
export function playClickSound() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 520;
    gain.gain.setValueAtTime(0.025, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.06);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.06);
    window.setTimeout(() => context.close(), 120);
  } catch {
    // audio context tidak tersedia
  }
}
