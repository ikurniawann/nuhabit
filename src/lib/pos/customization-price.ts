/**
 * Harga satuan produk POS setelah varian & modifier (add-on) dipilih.
 *
 * Kenapa perlu satu tempat + paksa Number(): kolom numeric Postgres pada
 * kolom biasa (base_price) datang sebagai STRING ("25000.00"), sedangkan
 * price_adjustment di relasi bersarang datang sebagai angka (lewat JSON).
 * Rumus lama `product.base_price + adj` jadi penggabungan teks —
 * "25000.00" + 10000 = "25000.00010000" → 25.000,0001 — sehingga add-on
 * +10.000 tidak menambah harga sama sekali. Cache produk offline (IndexedDB)
 * juga bisa menyimpan nilai string, jadi paksaan angka dilakukan di sini,
 * tidak hanya di API.
 */

type Numeric = number | string | null | undefined;

export type PricedVariant = { id: string; name: string; price_adjustment?: Numeric };
export type PricedModifierGroup = {
  modifier_group: {
    name: string;
    min_selection?: number | string | null;
    modifiers: Array<{ id: string; name: string; price_adjustment?: Numeric }>;
  };
};
export type PricedProduct = {
  base_price: Numeric;
  variants?: PricedVariant[] | null;
  modifiers?: PricedModifierGroup[] | null;
};

export type CustomizationPrice = {
  basePrice: number;
  variantName: string | undefined;
  variantAdj: number;
  modifierNames: string[];
  modifierAdj: number;
  unitPrice: number;
};

/**
 * Pilihan awal saat popup kustomisasi dibuka. Varian: yang pertama (ukuran
 * dsb. wajib ada). Modifier: HANYA grup wajib (min_selection ≥ 1) yang
 * diisi opsi pertama — add-on opsional (Special Beans, Oat Milk, …) mulai
 * kosong supaya kasir tidak menagih add-on yang tidak diminta.
 */
export function defaultCustomizationSelection(product: PricedProduct): {
  selectedVariant: string | null;
  selectedModifiers: Record<string, string[]>;
} {
  const selectedModifiers: Record<string, string[]> = {};
  for (const group of product.modifiers ?? []) {
    const required = Number(group.modifier_group.min_selection ?? 0) >= 1;
    const first = group.modifier_group.modifiers[0];
    if (required && first) selectedModifiers[group.modifier_group.name] = [first.id];
  }
  return { selectedVariant: product.variants?.[0]?.id ?? null, selectedModifiers };
}

export function toPrice(value: Numeric): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function computeCustomizationPrice(
  product: PricedProduct,
  selection: { selectedVariant?: string | null; selectedModifiers?: Record<string, string[]> | null } | null | undefined
): CustomizationPrice {
  const basePrice = toPrice(product.base_price);
  const variant = (product.variants ?? []).find((v) => v.id === selection?.selectedVariant);
  const variantAdj = toPrice(variant?.price_adjustment);

  const modifierNames: string[] = [];
  let modifierAdj = 0;
  for (const group of product.modifiers ?? []) {
    const ids = selection?.selectedModifiers?.[group.modifier_group.name] ?? [];
    for (const id of ids) {
      const mod = group.modifier_group.modifiers.find((m) => m.id === id);
      if (!mod) continue;
      modifierNames.push(mod.name);
      modifierAdj += toPrice(mod.price_adjustment);
    }
  }

  return {
    basePrice,
    variantName: variant?.name,
    variantAdj,
    modifierNames,
    modifierAdj,
    unitPrice: basePrice + variantAdj + modifierAdj,
  };
}
