// Aturan murni form pengaturan produk toko online (harga promo, sorotan).

export type SaleDraft = {
  /** Harga promo; kosong = tanpa promo */
  salePrice: string;
  /** Akhir promo "YYYY-MM-DD"; kosong = tanpa batas */
  saleUntil: string;
};

export type SaleFields = { sale_price_idr: number | null; sale_until: string | null };

/** Tanggal input (YYYY-MM-DD) dari ISO akhir promo, untuk input date. */
export const saleUntilInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * Harga promo harus di bawah harga normal; tanggal akhir menjadi akhir hari
 * WIB dan hanya berlaku bila ada harga promo.
 */
export function checkSale(draft: SaleDraft, regularPrice: number): ({ ok: true } & SaleFields) | { ok: false; error: string } {
  const price = draft.salePrice.trim() === "" ? null : Number(draft.salePrice);
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return { ok: false, error: "Harga promo harus angka > 0, atau kosongkan" };
  if (price !== null && price >= regularPrice) return { ok: false, error: "Harga promo harus lebih rendah dari harga normal" };
  const until = draft.saleUntil.trim();
  if (until !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { ok: false, error: "Tanggal akhir promo tidak valid" };
  return { ok: true, sale_price_idr: price, sale_until: price !== null && until !== "" ? `${until}T23:59:59+07:00` : null };
}
