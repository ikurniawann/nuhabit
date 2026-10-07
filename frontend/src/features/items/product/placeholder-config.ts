export const PRODUCT_PLACEHOLDER_PAGES: Record<
  string,
  { title: string; description: string }
> = {
  // Inventory
  "inventory/transfer": {
    title: "Product Stock Transfer",
    description:
      "Halaman transfer stok produk jadi antar gudang, outlet, atau lokasi penyimpanan.",
  },
};

export function getProductPlaceholder(path: string) {
  return PRODUCT_PLACEHOLDER_PAGES[path] ?? null;
}
