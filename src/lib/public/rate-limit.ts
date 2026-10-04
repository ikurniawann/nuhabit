// Rate limiter in-memory sederhana untuk endpoint publik (booking).
// Sliding window per kunci (ip+route). Cukup untuk deployment PM2
// satu proses; kalau nanti multi-instance, ganti backing store (Redis).

interface WindowEntry {
  timestamps: number[];
}

const buckets = new Map<string, WindowEntry>();
const MAX_BUCKETS = 10_000; // rem darurat memori — bucket tertua dibuang

export interface RateLimitRule {
  /** Jumlah request maksimum per jendela. */
  limit: number;
  /** Lebar jendela dalam milidetik. */
  windowMs: number;
}

export function checkRateLimit(key: string, rule: RateLimitRule): boolean {
  const now = Date.now();
  const cutoff = now - rule.windowMs;

  let entry = buckets.get(key);
  if (!entry) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    entry = { timestamps: [] };
    buckets.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  if (entry.timestamps.length >= rule.limit) return false;

  entry.timestamps.push(now);
  return true;
}

/** IP klien utk kunci rate limit. Model kepercayaan: lihat lib/security/client-ip. */
export { clientIpFromHeaders as clientIpFrom } from "@/lib/security/client-ip";

/** Reset semua bucket — khusus test. */
export function resetRateLimits(): void {
  buckets.clear();
}
