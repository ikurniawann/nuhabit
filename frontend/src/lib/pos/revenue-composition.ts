/**
 * Pengelompokan Food vs Beverage untuk laporan Revenue Composition.
 *
 * Sumber kelompok adalah kategori master (`item.products.kategori`), bukan
 * `pos_categories` — kategori POS hanya bucket kasir (Makanan / Minuman /
 * Dessert), lihat catatan di `profit-category.ts`. Kategori POS tetap dipakai
 * sebagai cadangan untuk produk lama yang belum tertaut ke master.
 *
 * Bakery dan Dessert masuk **Food**, mengikuti workbook Menu Matrix yang hanya
 * mengenal dua baris biaya: Food Cost dan Beverage Cost.
 */

export type RevenueGroupId = "food" | "beverage";

export const REVENUE_GROUP_LABEL: Record<RevenueGroupId, string> = {
  food: "Food",
  beverage: "Beverage",
};

/**
 * Kata kunci minuman. `bakery` diperiksa lebih dulu supaya `BAKERY-BAR`
 * tidak tertangkap oleh kata `bar`.
 */
const BAKERY_PATTERN = /bakery|dessert|pastry/i;
const BEVERAGE_PATTERN = /beverage|minuman|coffee|matcha[\s-]*bar|tea|drink|barista|yokoco/i;

export function resolveRevenueGroup(input: {
  itemCategory?: string | null;
  posCategoryName?: string | null;
  station?: string | null;
}): RevenueGroupId {
  const source = [input.itemCategory, input.posCategoryName]
    .map((value) => String(value || "").trim())
    .find((value) => value.length > 0);

  if (source) {
    if (BAKERY_PATTERN.test(source)) return "food";
    return BEVERAGE_PATTERN.test(source) ? "beverage" : "food";
  }

  // Produk tanpa kategori sama sekali: jatuh balik ke station snapshot.
  return String(input.station || "").trim().toLowerCase() === "bar" ? "beverage" : "food";
}

export type RevenueBucket = {
  id: string;
  label: string;
  quantity: number;
  sales: number;
  cost: number;
  margin: number;
  cost_pct: number;
  sales_share_pct: number;
  qty_share_pct: number;
};

export function emptyBucket(id: string, label: string): RevenueBucket {
  return {
    id,
    label,
    quantity: 0,
    sales: 0,
    cost: 0,
    margin: 0,
    cost_pct: 0,
    sales_share_pct: 0,
    qty_share_pct: 0,
  };
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

/** Persentase yang aman dibagi nol — dipakai untuk cost% dan porsi kontribusi. */
export function safePct(part: number, whole: number) {
  const base = Number(whole) || 0;
  if (base === 0) return 0;
  return round2((Number(part) || 0) / base * 100);
}

/**
 * Lengkapi turunan sebuah bucket: margin, cost%, dan porsinya terhadap total.
 * `totals` dipakai untuk share; kirim bucket itu sendiri bila tidak relevan.
 */
export function finalizeBucket(
  bucket: RevenueBucket,
  totals: { sales: number; quantity: number }
): RevenueBucket {
  const sales = round2(bucket.sales);
  const cost = round2(bucket.cost);
  return {
    ...bucket,
    sales,
    cost,
    margin: round2(sales - cost),
    cost_pct: safePct(cost, sales),
    sales_share_pct: safePct(sales, totals.sales),
    qty_share_pct: safePct(bucket.quantity, totals.quantity),
  };
}
