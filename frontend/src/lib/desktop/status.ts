/**
 * Status operasional untuk menubar desktop: sekali lihat tahu printer,
 * WhatsApp gateway, dan database sedang sehat atau tidak.
 */

export type StatusLevel = "ok" | "warn" | "down" | "unknown";

export interface StatusItem {
  key: string;
  label: string;
  level: StatusLevel;
  detail?: string | null;
}

const ORDER: Record<StatusLevel, number> = { down: 0, warn: 1, unknown: 2, ok: 3 };

/** Lampu menubar = kondisi TERBURUK; satu layanan mati tidak boleh tersamar. */
export function rollupStatus(items: StatusItem[]): StatusLevel {
  if (items.length === 0) return "unknown";
  return items.reduce<StatusLevel>(
    (worst, item) => (ORDER[item.level] < ORDER[worst] ? item.level : worst),
    "ok"
  );
}

export function statusLabel(level: StatusLevel): string {
  switch (level) {
    case "ok":
      return "Semua layanan normal";
    case "warn":
      return "Ada yang perlu dilihat";
    case "down":
      return "Ada layanan mati";
    default:
      return "Status belum diketahui";
  }
}

/** Antrian cetak: menumpuk = printer kemungkinan mati / kertas habis. */
export function printQueueLevel(pending: number, stuckMinutes: number | null): StatusLevel {
  if (pending === 0) return "ok";
  if (stuckMinutes !== null && stuckMinutes >= 10) return "down";
  if (pending >= 10) return "warn";
  return "ok";
}
