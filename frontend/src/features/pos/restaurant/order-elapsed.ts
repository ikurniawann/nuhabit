/** Elapsed since order time, aligned to live restaurant clock. */
export function formatOrderElapsed(value?: string, nowMs = Date.now()) {
  if (!value) return "-";
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return "-";
  const minutes = Math.max(0, Math.floor((nowMs - started) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
