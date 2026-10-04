/** Logika tampilan Live Monitoring rekrutmen (HRD). */

const STALE_FRAME_MS = 30_000;

/** Lama sesi berjalan: "12 mnt" / "1 jam 5 mnt"; kosong bila belum mulai. */
export function elapsedLabel(startedAt: string | null, now: number): string {
  if (!startedAt) return "";
  const mins = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000));
  if (mins < 60) return `${mins} mnt`;
  return `${Math.floor(mins / 60)} jam ${mins % 60} mnt`;
}

/** Frame dianggap basi bila > 30 detik tidak diperbarui (now 0 = belum diketahui). */
export function isFrameStale(frameUpdatedAt: string | null, now: number): boolean {
  return now > 0 && frameUpdatedAt != null && now - new Date(frameUpdatedAt).getTime() > STALE_FRAME_MS;
}

/** Tambahkan pesan baru (dedupe per id); referensi lama dipertahankan bila tak ada yang baru. */
export function mergeChatMessages<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  const known = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  return fresh.length > 0 ? [...prev, ...fresh] : prev;
}
