/**
 * Bangun payload katalog GoFood dari katalog POS (murni, teruji).
 *
 * Aturan GoBiz (developer.gobiz.com → Sync Menu):
 * - PUT katalog = FULL REPLACE — semua menu & variant category harus dikirim.
 * - external_id item = id pos_products; external_id varian = id pos_product_variants
 *   → webhook order membawa external_id yang sama, jadi pemetaan balik pasti.
 * - Varian satu level; harga varian ditambahkan ke harga item.
 * - Gambar harus URL http(s) port 80/443, jpeg/png.
 */

import { applyChannelMarkup, resolveChannelPrice, type ChannelRule } from "@/lib/pos/channel-pricing";
import type { GobizCatalogPayload } from "./types";

export type CatalogProductInput = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  /** URL absolut atau path relatif (/products/x.png) */
  image?: string | null;
  inStock: boolean;
  categoryName?: string | null;
  variants: Array<{ id: string; name: string; priceAdjustment: number; groupName?: string | null }>;
};

export type CatalogBuildResult = {
  payload: GobizCatalogPayload;
  stats: {
    menus: number;
    items: number;
    variantCategories: number;
    skipped: Array<{ id: string; name: string; reason: string }>;
  };
};

const NAME_MAX = 150;
const DEFAULT_MENU = "Menu";

function clampName(value: string) {
  const trimmed = value.trim();
  return trimmed.length > NAME_MAX ? trimmed.slice(0, NAME_MAX) : trimmed;
}

export function absoluteImageUrl(image: string | null | undefined, appUrl: string): string | undefined {
  const value = String(image || "").trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (!appUrl) return undefined;
  return `${appUrl.replace(/\/$/, "")}${value.startsWith("/") ? "" : "/"}${value}`;
}

/**
 * Terapkan harga channel GoFood (POS → Katalog → Harga Channel): harga item
 * = harga manual bila ada, selain itu base_price + markup dibulatkan; harga
 * varian = tambahan varian + markup yang sama. Channel nonaktif = harga dasar.
 */
export function priceCatalogForChannel(
  products: CatalogProductInput[],
  rule: ChannelRule,
  overrides: ReadonlyMap<string, number>
): CatalogProductInput[] {
  return products.map((product) => ({
    ...product,
    price: resolveChannelPrice(product.price, rule, overrides.get(product.id)).final,
    variants: product.variants.map((variant) => ({
      ...variant,
      priceAdjustment: applyChannelMarkup(variant.priceAdjustment, rule),
    })),
  }));
}

export function variantCategoryId(productId: string) {
  return `vc:${productId}`;
}

export function buildGobizCatalog(
  products: CatalogProductInput[],
  options: { appUrl: string; requestId: string }
): CatalogBuildResult {
  const menus = new Map<string, GobizCatalogPayload["menus"][number]>();
  const variantCategories: GobizCatalogPayload["variant_categories"] = [];
  const skipped: CatalogBuildResult["stats"]["skipped"] = [];
  let items = 0;

  for (const product of products) {
    const price = Math.round(Number(product.price) || 0);
    if (price <= 0) {
      skipped.push({ id: product.id, name: product.name, reason: "harga 0" });
      continue;
    }
    const name = clampName(product.name);
    if (!name) {
      skipped.push({ id: product.id, name: product.name, reason: "nama kosong" });
      continue;
    }

    const menuName = clampName(product.categoryName || "") || DEFAULT_MENU;
    let menu = menus.get(menuName);
    if (!menu) {
      menu = { name: menuName, menu_items: [] };
      menus.set(menuName, menu);
    }

    const activeVariants = product.variants.filter((variant) => variant.id && variant.name.trim());
    const item: GobizCatalogPayload["menus"][number]["menu_items"][number] = {
      external_id: product.id,
      name,
      in_stock: product.inStock,
      price,
    };
    const description = String(product.description || "").trim();
    if (description) item.description = description;
    const image = absoluteImageUrl(product.image, options.appUrl);
    if (image) item.image = image;

    if (activeVariants.length > 0) {
      const categoryId = variantCategoryId(product.id);
      const groupName = clampName(activeVariants[0].groupName || "") || "Pilihan";
      variantCategories.push({
        external_id: categoryId,
        internal_name: clampName(`${name} — ${groupName}`),
        name: groupName,
        rules: { selection: { min_quantity: 1, max_quantity: 1 } },
        variants: activeVariants.map((variant) => ({
          external_id: variant.id,
          name: clampName(variant.name),
          price: Math.max(0, Math.round(Number(variant.priceAdjustment) || 0)),
          in_stock: true,
        })),
      });
      item.variant_category_external_ids = [categoryId];
    }

    menu.menu_items.push(item);
    items += 1;
  }

  return {
    payload: {
      request_id: options.requestId,
      menus: [...menus.values()],
      variant_categories: variantCategories,
    },
    stats: { menus: menus.size, items, variantCategories: variantCategories.length, skipped },
  };
}
