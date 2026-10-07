/**
 * Target omzet (EPIC-021 Fase B) — disimpan satu JSON di
 * configuration.app_settings key `sales_target_config`.
 * Murni tanpa I/O supaya teruji; baca/tulisnya di route API.
 */

export interface SalesTargetConfig {
  /** Target omzet per hari (Rp). 0 = belum diatur → UI tidak menampilkan %. */
  harianRp: number;
  /** Target omzet per bulan (Rp). 0 = belum diatur. */
  bulananRp: number;
}

export const SALES_TARGET_SETTING_KEY = "sales_target_config";

export function defaultSalesTarget(): SalesTargetConfig {
  return { harianRp: 0, bulananRp: 0 };
}

function cleanAmount(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    // Buang HANYA pemisah format (titik/koma/spasi/"Rp"); sisa non-digit lain
    // berarti input sampah. Membuang semua \D membuat "abc" menjadi 0 — yang
    // diam-diam MENGHAPUS target, persis bug yang ditangkap unit test.
    const stripped = value.replace(/[rp\s.,]/gi, "");
    if (!/^\d+$/.test(stripped)) return null;
    n = Number(stripped);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0) return null;
  // Rp 100 M sebagai plafon waras — mencegah salah ketik nol berlebih
  if (n > 100_000_000_000) return null;
  return Math.round(n);
}

/** Nilai tersimpan (JSON string / null) → config valid; rusak = default. */
export function parseSalesTarget(raw: string | null): SalesTargetConfig {
  const base = defaultSalesTarget();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      harianRp: cleanAmount(o.harianRp) ?? base.harianRp,
      bulananRp: cleanAmount(o.bulananRp) ?? base.bulananRp,
    };
  } catch {
    return base;
  }
}

/** Input user (angka/string berformat) → config siap simpan; null = tolak. */
export function sanitizeSalesTargetInput(input: {
  harianRp?: unknown;
  bulananRp?: unknown;
}): Partial<SalesTargetConfig> | null {
  const out: Partial<SalesTargetConfig> = {};
  if (input.harianRp !== undefined) {
    const n = cleanAmount(input.harianRp);
    if (n === null) return null;
    out.harianRp = n;
  }
  if (input.bulananRp !== undefined) {
    const n = cleanAmount(input.bulananRp);
    if (n === null) return null;
    out.bulananRp = n;
  }
  return out;
}
