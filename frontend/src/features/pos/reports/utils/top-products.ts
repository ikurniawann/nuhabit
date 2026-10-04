export type TopProductSort = "qty" | "omset";

export const TOP_PRODUCTS_DISPLAY_LIMIT = 10;

type SortableTopProduct = {
  product_name: string;
  quantity: number;
  revenue: number;
};

export function sortTopProducts<T extends SortableTopProduct>(
  products: T[],
  sort: TopProductSort,
  limit = TOP_PRODUCTS_DISPLAY_LIMIT
): T[] {
  const key = sort === "qty" ? "quantity" : "revenue";
  const otherKey = sort === "qty" ? "revenue" : "quantity";
  return [...products]
    .sort((a, b) => {
      const primary = b[key] - a[key];
      if (primary !== 0) return primary;
      const secondary = b[otherKey] - a[otherKey];
      if (secondary !== 0) return secondary;
      return a.product_name.localeCompare(b.product_name, "id");
    })
    .slice(0, limit);
}

export function topProductBarValue(
  product: Pick<SortableTopProduct, "quantity" | "revenue">,
  sort: TopProductSort
): number {
  return sort === "qty" ? product.quantity : product.revenue;
}
