import path from "path";

/**
 * Validasi segmen path dari route catch-all ([...path]) sebelum dipakai
 * membaca berkas. Next sudah men-decode %2F menjadi "/" di dalam satu segmen,
 * jadi cek "segmen pertama = folder" saja tidak cukup: "a%2F..%2F..%2Fb"
 * lolos sebagai satu segmen. Setiap segmen di-decode sekali lagi (menangkap
 * %252F) lalu ditolak bila kosong, ".", "..", diawali ".", atau memuat
 * "/", "\" atau NUL.
 */
export function safeSegments(segments: readonly string[]): string[] | null {
  if (segments.length === 0) return null;
  const out: string[] = [];
  for (const raw of segments) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg.startsWith(".") || /[/\\\0]/.test(seg)) return null;
    out.push(seg);
  }
  return out;
}

/** True bila `resolved` sama dengan `prefix` atau berada di bawahnya. */
export function isWithinPrefix(resolved: string, prefix: string): boolean {
  const target = path.resolve(resolved);
  const base = path.resolve(prefix);
  return target === base || target.startsWith(base + path.sep);
}

/**
 * Segmen aman yang diawali `folder` dengan minimal `minLength` segmen
 * (termasuk folder), atau null. Dipakai route penyaji storage private.
 */
export function safeSegmentsUnder(
  segments: readonly string[],
  folder: string,
  minLength = 2
): string[] | null {
  const safe = safeSegments(segments);
  if (!safe || safe.length < minLength || safe[0] !== folder) return null;
  return isWithinPrefix(path.join(...safe), folder) ? safe : null;
}
