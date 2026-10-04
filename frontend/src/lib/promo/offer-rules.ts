import { SALES_CHANNEL_CODES } from "@/lib/pos/sales-channels";

export const OFFER_TYPES = ["bundle", "bxgy", "volume"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];
export type OfferItemRole = "component" | "buy" | "get" | "eligible";
export type BxgyGetMode = "same_as_buy" | "specific_products";
export type VolumeBasis = "qty" | "spend";
export type OfferDiscountType = "percent" | "fixed";

export type OfferRuleItemInput = {
  role: OfferItemRole;
  /** Tepat satu dari product_id / category_id. */
  product_id?: string | null;
  category_id?: string | null;
  qty?: number;
  sort_order?: number;
};

export type OfferRuleInput = {
  offer_type: OfferType;
  name: string;
  description?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  bundle_price?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  get_mode?: BxgyGetMode | null;
  volume_basis?: VolumeBasis | null;
  volume_min?: number | null;
  discount_type?: OfferDiscountType | null;
  discount_value?: number | null;
  /** null/kosong = semua channel. */
  sales_channels?: string[] | null;
  max_uses?: number | null;
  max_uses_per_member?: number | null;
  is_exclusive?: boolean;
  priority?: number;
  /** Diisi = penawaran hanya aktif setelah kode ini diketik di kasir. */
  unlock_code?: string | null;
  items: OfferRuleItemInput[];
};

const UNLOCK_CODE_FORMAT = /^[A-Za-z0-9-]{3,40}$/;

const isPositiveIntOrNull = (value: number | null | undefined) =>
  value == null || (Number.isInteger(Number(value)) && Number(value) > 0);

/** Aturan umum lintas tipe: target, channel, kuota, prioritas, kode. */
function validateOfferCommon(input: OfferRuleInput): string | null {
  const items = input.items ?? [];
  if (items.some((i) => Boolean(i.product_id) === Boolean(i.category_id))) {
    return "Setiap baris wajib memilih produk ATAU kategori";
  }
  const channels = input.sales_channels ?? [];
  if (channels.some((c) => !(SALES_CHANNEL_CODES as readonly string[]).includes(c))) {
    return "Channel penjualan tidak dikenal";
  }
  if (!isPositiveIntOrNull(input.max_uses)) return "Kuota total wajib bilangan bulat > 0";
  if (!isPositiveIntOrNull(input.max_uses_per_member)) {
    return "Kuota per member wajib bilangan bulat > 0";
  }
  const priority = input.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
    return "Prioritas wajib angka 0–1000";
  }
  const code = input.unlock_code?.trim();
  if (code && !UNLOCK_CODE_FORMAT.test(code)) {
    return "Kode pembuka: huruf/angka/strip, 3–40 karakter";
  }
  return null;
}

export function validateOfferRule(input: OfferRuleInput): string | null {
  const name = input.name?.trim();
  if (!name) return "Nama wajib diisi";

  if (input.valid_from && input.valid_until && input.valid_from > input.valid_until) {
    return "Tanggal mulai tidak boleh setelah tanggal selesai";
  }

  const commonError = validateOfferCommon(input);
  if (commonError) return commonError;

  const items = input.items ?? [];

  if (input.offer_type === "bundle") {
    const components = items.filter((i) => i.role === "component");
    if (components.some((i) => i.category_id)) {
      return "Komponen bundling harus produk, bukan kategori";
    }
    if (components.length < 2) return "Bundling minimal 2 produk komponen";
    if (!(Number(input.bundle_price) > 0)) return "Harga bundling wajib > 0";
    if (components.some((i) => !(Number(i.qty) > 0))) {
      return "Qty tiap komponen wajib > 0";
    }
    return null;
  }

  if (input.offer_type === "bxgy") {
    if (!(Number(input.buy_qty) > 0)) return "Qty beli wajib > 0";
    if (!(Number(input.get_qty) > 0)) return "Qty gratis wajib > 0";
    const buy = items.filter((i) => i.role === "buy");
    if (buy.length < 1) return "Pilih minimal 1 produk yang dibeli (atau kategori)";
    const mode = input.get_mode ?? "same_as_buy";
    if (mode === "specific_products") {
      const get = items.filter((i) => i.role === "get");
      if (get.length < 1) return "Pilih minimal 1 produk gratis (atau kategori)";
    }
    return null;
  }

  if (input.offer_type === "volume") {
    if (!input.volume_basis) return "Basis volume wajib (qty / belanja)";
    if (!(Number(input.volume_min) > 0)) return "Minimum qty/belanja wajib > 0";
    if (!input.discount_type) return "Tipe diskon wajib";
    if (!(Number(input.discount_value) > 0)) return "Nilai diskon wajib > 0";
    if (input.discount_type === "percent" && Number(input.discount_value) > 100) {
      return "Diskon persen maksimal 100";
    }
    return null;
  }

  return "Tipe offer tidak dikenal";
}

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  bundle: "Bundling",
  bxgy: "Buy X Get Y",
  volume: "Diskon Volume",
};
