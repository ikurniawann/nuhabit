/** Helper tampilan Google Review (klien) — label & format durasi. */
export { RATING_LABELS } from "@/lib/crm/google-reviews";

export function formatReviewWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j`;
  const days = Math.floor(hours / 24);
  return `${days} hari`;
}
