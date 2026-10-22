/**
 * Sisa slot kelas di Member App (revisi client 2026-10-22): tampilkan "slots
 * left" untuk menunjukkan ketersediaan dan mendorong member segera booking.
 * Bahasa Inggris, seperti seluruh Member App.
 */

export type SlotTone = "full" | "last" | "low" | "open";

/** Hampir penuh: sisa ≤ 3 atau ≤ 25% kapasitas (kelas besar tetap terasa mendesak). */
export function slotTone(spotsLeft: number, capacity: number): SlotTone {
  if (spotsLeft <= 0) return "full";
  if (spotsLeft === 1) return "last";
  if (spotsLeft <= Math.max(3, Math.floor(capacity * 0.25))) return "low";
  return "open";
}

const plural = (n: number) => `${n} ${n === 1 ? "slot" : "slots"}`;

/** Label singkat di kartu jadwal. */
export function slotsLeftLabel(spotsLeft: number, capacity: number): string {
  switch (slotTone(spotsLeft, capacity)) {
    case "full":
      return "Full · Join waitlist";
    case "last":
      return "Last slot!";
    case "low":
      return `Only ${plural(spotsLeft)} left`;
    default:
      return `${plural(spotsLeft)} left`;
  }
}

/** Kalimat ajakan di detail kelas. */
export function slotsLeftPitch(spotsLeft: number, capacity: number, waitlist: number): string {
  switch (slotTone(spotsLeft, capacity)) {
    case "full":
      return waitlist > 0
        ? `This class is full · ${waitlist} on the waitlist. Join now and we'll let you know if a spot opens up.`
        : "This class is full. Join the waitlist and we'll let you know if a spot opens up.";
    case "last":
      return "Last slot left — book now before it's gone.";
    case "low":
      return `Only ${plural(spotsLeft)} left — book now to lock in your spot.`;
    default:
      return `${plural(spotsLeft)} left of ${capacity}.`;
  }
}

/** Persentase terisi untuk bar keterisian (0–100). */
export function filledPercent(spotsLeft: number, capacity: number): number {
  if (capacity <= 0) return 100;
  return Math.round(((capacity - Math.max(0, Math.min(capacity, spotsLeft))) / capacity) * 100);
}
