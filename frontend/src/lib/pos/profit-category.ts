/**
 * Kategori laporan profit POS.
 *
 * `pos_categories` dipakai kasir sebagai bucket stall/grup (Makanan, Minuman,
 * Dessert) — hasil `normalizeCategoryName` / seeder menu matrix. Top Categories
 * harus memakai kategori master `item.products.kategori`.
 */

const POS_GROUP_CATEGORY_KEYS = new Set(["makanan", "minuman", "dessert"]);

export function isPosGroupCategory(name?: string | null) {
  return POS_GROUP_CATEGORY_KEYS.has(String(name || "").trim().toLowerCase());
}

export function itemCategoryLabelMap(
  categories: Array<{ code?: string | null; nama?: string | null }>
) {
  const map = new Map<string, string>();
  for (const category of categories) {
    const code = String(category.code || "").trim();
    const nama = String(category.nama || "").trim();
    const label = nama || code;
    if (!label) continue;
    if (code) map.set(code.toLowerCase(), label);
    if (nama) map.set(nama.toLowerCase(), nama);
  }
  return map;
}

export function lookupItemCategoryName(
  kategori: string | null | undefined,
  labels: Map<string, string>
) {
  const key = String(kategori || "").trim();
  if (!key) return null;
  return labels.get(key.toLowerCase()) || key;
}

export function resolveProfitCategory(input: {
  itemCategoryCode?: string | null;
  itemCategoryName?: string | null;
  posCategoryName?: string | null;
}) {
  const itemName = String(input.itemCategoryName || "").trim();
  const itemCode = String(input.itemCategoryCode || "").trim();
  if (itemCode && !isPosGroupCategory(itemCode)) {
    const label = itemName && !isPosGroupCategory(itemName) ? itemName : itemCode;
    return { id: itemCode, label };
  }
  if (itemName && !isPosGroupCategory(itemName)) {
    return { id: itemName, label: itemName };
  }
  const posName = String(input.posCategoryName || "").trim();
  if (posName && !isPosGroupCategory(posName)) {
    return { id: posName, label: posName };
  }
  return { id: "uncategorized", label: "Tanpa kategori" };
}
