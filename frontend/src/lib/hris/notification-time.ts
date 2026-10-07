import { formatDate } from "@/lib/format";

/** "Baru saja", "5 menit lalu", "3 jam lalu", "2 hari lalu", lalu tanggal biasa. */
export function timeAgo(dateStr: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} hari lalu`;
  return formatDate(dateStr);
}

/** Belum dibaca dulu, lalu terbaru. */
export function sortNotifications<T extends { is_read: boolean; created_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
