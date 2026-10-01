/**
 * Harga member (diskon tier) — rumus sama dengan stack diskon kasir
 * (lib/pos/manual-discount: floor(basis × persen / 100)). Dipakai utk harga
 * coret di kasir modern/klasik dan self-order meja.
 */

export function memberDiscountAmount(amount: number, percent: number) {
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const basis = Math.max(0, Number(amount) || 0);
  return pct > 0 ? Math.floor((basis * pct) / 100) : 0;
}

/** Harga setelah diskon member — utk tampilan harga coret per item. */
export function memberPrice(price: number, percent: number) {
  return Math.max(0, price - memberDiscountAmount(price, percent));
}
