// EPIC-039 Fase B — normalisasi payload varian SKU (dipakai route skus).

export type SkuPayload = {
  sku?: string;
  name?: string;
  options?: Record<string, string> | null;
  barcode?: string | null;
  price_override?: number | string | null;
  stock_quantity?: number | string;
  is_active?: boolean;
};

type NormalizeResult =
  | { ok: true; columns: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * `requireCore` (create): sku + name wajib. PATCH parsial: hanya field yang
 * dikirim yang dinormalisasi.
 */
export function normalizeSkuPayload(
  body: SkuPayload,
  opts: { requireCore?: boolean } = {}
): NormalizeResult {
  const columns: Record<string, unknown> = {};

  if (body.sku !== undefined || opts.requireCore) {
    const sku = String(body.sku || '').trim();
    if (!sku) return { ok: false, error: 'Kode SKU wajib diisi' };
    if (sku.length > 60) return { ok: false, error: 'Kode SKU maksimal 60 karakter' };
    columns.sku = sku;
  }

  if (body.name !== undefined || opts.requireCore) {
    const name = String(body.name || '').trim();
    if (!name) return { ok: false, error: 'Nama varian wajib diisi' };
    if (name.length > 120) return { ok: false, error: 'Nama varian maksimal 120 karakter' };
    columns.name = name;
  }

  if (body.barcode !== undefined) {
    const barcode = String(body.barcode || '').trim();
    if (barcode.length > 64) return { ok: false, error: 'Barcode maksimal 64 karakter' };
    columns.barcode = barcode || null;
  }

  if (body.options !== undefined) {
    columns.options =
      body.options && typeof body.options === 'object' ? body.options : {};
  }

  if (body.price_override !== undefined) {
    if (body.price_override === null || body.price_override === '') {
      columns.price_override = null;
    } else {
      const price = Number(body.price_override);
      if (!Number.isFinite(price) || price < 0) {
        return { ok: false, error: 'Harga varian harus angka ≥ 0' };
      }
      columns.price_override = price;
    }
  }

  if (body.stock_quantity !== undefined) {
    const stock = Number(body.stock_quantity);
    if (!Number.isFinite(stock)) {
      return { ok: false, error: 'Stok varian harus angka' };
    }
    columns.stock_quantity = stock;
  }

  if (body.is_active !== undefined) {
    columns.is_active = Boolean(body.is_active);
  }

  return { ok: true, columns };
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message || '';
  return code === '23505' || /duplicate key|unique/i.test(message);
}
