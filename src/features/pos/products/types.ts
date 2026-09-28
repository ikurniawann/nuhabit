/** EPIC-039 Fase B — varian merchandise ber-stok per SKU */
export type PosMerchSku = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  priceOverride: number | null;
  stock: number;
  active: boolean;
};

export type ApiPosProductSku = {
  id: string;
  sku?: string | null;
  name?: string | null;
  barcode?: string | null;
  price_override?: number | string | null;
  stock_quantity?: number | string | null;
  is_active?: boolean | null;
};

export type PosProductVariant = {
  id: string;
  name: string;
  sku: string;
  priceAdj: number;
  active: boolean;
};

export type PosProductModifier = {
  id: string;
  name: string;
  priceAdj: number;
  active: boolean;
};

export type PosProductModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  active: boolean;
  modifiers: PosProductModifier[];
};

export type PosCatalogProduct = {
  id: string;
  sku?: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  status: "active" | "inactive";
  station: string;
  hasVariants: boolean;
  hasModifiers: boolean;
  variants: PosProductVariant[];
  modifierGroups: PosProductModifierGroup[];
  /** Syarat privilege member: minimal lifetime XP; null = produk umum */
  minXp: number | null;
  /** EPIC-039 Fase A — regular | gift_card | merchandise */
  productKind: string;
  /** Tautan master purchasing (item.products); null = tidak tertaut */
  sourceProductId: string | null;
  inventoryTracking: boolean;
  inventoryQuantity: number;
  weightGram: number | null;
  /** Varian ber-SKU (Fase B); stok produk ber-varian = SUM stok SKU */
  merchSkus: PosMerchSku[];
  /** Fase D — tampil di katalog toko online (channel 'web') */
  webDistributed: boolean;
  /** Channel penjualan (lib/pos/sales-channels); null = semua channel */
  salesChannels: string[] | null;
};

export type ApiPosProduct = {
  id: string;
  sku?: string | null;
  name?: string | null;
  category?: { name?: string | null } | { name?: string | null }[] | string | null;
  base_price?: number | string | null;
  cost_price?: number | string | null;
  estimated_cogs?: number | string | null;
  hpp_estimasi?: number | string | null;
  station?: string | null;
  is_active?: boolean | null;
  min_xp?: number | string | null;
  product_kind?: string | null;
  source_product_id?: string | null;
  inventory_tracking?: boolean | null;
  inventory_quantity?: number | string | null;
  weight_gram?: number | string | null;
  skus?: ApiPosProductSku[] | null;
  channels?: Array<{ channel_code?: string | null; is_distributed?: boolean | null }> | null;
  sales_channels?: string[] | string | null;
  variants?: Array<{
    id?: string;
    name?: string | null;
    sku?: string | null;
    price_adjustment?: number | string | null;
    is_active?: boolean | null;
  }> | null;
  modifiers?: Array<{
    modifier_group?: {
      name?: string | null;
      min_selection?: number | string | null;
      max_selection?: number | string | null;
      modifiers?: Array<{
        id?: string;
        name?: string | null;
        price_adjustment?: number | string | null;
        is_active?: boolean | null;
      }> | null;
    } | null;
  }> | null;
};

export interface PatchPosProductPayload {
  is_active?: boolean;
  station?: string;
  /** null = hapus syarat (produk umum) */
  min_xp?: number | null;
  /** EPIC-039 Fase A — regular | merchandise (gift_card diatur EPIC-034) */
  product_kind?: string;
  /** null = lepaskan tautan purchasing */
  source_product_id?: string | null;
  inventory_tracking?: boolean;
  inventory_quantity?: number;
  weight_gram?: number | null;
  /** Fase D — upsert shop.product_channels channel 'web' */
  web_distributed?: boolean;
  /** null = semua channel; mis. ["gofood"] = hanya GoFood */
  sales_channels?: string[] | null;
}
