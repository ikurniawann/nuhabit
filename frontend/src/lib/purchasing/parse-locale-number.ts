/** Max value for Postgres numeric(15,2). */
export const MAX_NUMERIC_15_2 = 9_999_999_999_999.99;

/**
 * Parse angka dari input user (format ID) atau string numerik DB (mis. "287985.600000").
 * Tidak boleh menganggap semua titik sebagai pemisah ribuan — satu titik dengan
 * bagian desimal panjang adalah desimal PostgreSQL, bukan "287985" + "600000".
 */
export function parseLocaleNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const negative = trimmed.startsWith("-");
  const raw = (negative ? trimmed.slice(1) : trimmed).replace(/[^\d.,]/g, "");
  if (!raw) return undefined;

  let normalized: string;

  if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (raw.match(/\./g) || []).length;
    if (dots > 1) {
      normalized = raw.replace(/\./g, "");
    } else if (dots === 1) {
      const [left, right] = raw.split(".");
      if (right.length === 3 && left.length <= 3) {
        normalized = left + right;
      } else {
        normalized = `${left}.${right}`;
      }
    } else {
      normalized = raw;
    }
  }

  const parsed = Number(negative ? `-${normalized}` : normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampMoney(value: number): number {
  const rounded = roundMoney(value);
  if (rounded < 0) return 0;
  if (rounded > MAX_NUMERIC_15_2) return MAX_NUMERIC_15_2;
  return rounded;
}

export function normalizePrQty(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded < 1) return 1;
  return Math.min(rounded, 2_147_483_647);
}

export function normalizePrItemAmounts(item: { qty: number; estimated_price: number }) {
  const qty = normalizePrQty(item.qty);
  const estimated_price = clampMoney(item.estimated_price);
  const total = clampMoney(qty * estimated_price);
  return { qty, estimated_price, total };
}
