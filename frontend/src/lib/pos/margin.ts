/** Margin kotor dalam persen (2 desimal) dari harga jual dan HPP. */
export function computeMarginPercentage(price: number, cost: number) {
  if (price <= 0) return 0;
  return Math.round(((price - cost) / price) * 10000) / 100;
}
