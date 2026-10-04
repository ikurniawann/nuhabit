// Bonus XP per produk (pos_products.bonus_xp): XP tetap per unit yang
// diberikan sekali per order member lunas, di luar XP belanja.

export type BonusXpLine = {
  product_id?: string | null;
  productId?: string | null;
  quantity?: number | string | null;
};

/** sum(qty × bonus_xp). Qty pecahan dibulatkan ke bawah; nilai negatif = 0. */
export function computeProductBonusXp(
  items: BonusXpLine[],
  bonusByProduct: Map<string, number>
): number {
  let total = 0;
  for (const item of items) {
    const productId = item.product_id ?? item.productId;
    if (!productId) continue;
    const bonus = Math.max(0, Math.floor(bonusByProduct.get(productId) ?? 0));
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    total += bonus * quantity;
  }
  return total;
}
