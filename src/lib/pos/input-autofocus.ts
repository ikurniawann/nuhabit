/**
 * Fokus otomatis input hanya utk perangkat ber-mouse. Di tablet/HP (layar
 * sentuh) fokus otomatis memunculkan keyboard virtual yang menutupi daftar
 * (owner 2026-10-01, Find Customer di kasir).
 */
export function prefersInputAutoFocus() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches;
}
