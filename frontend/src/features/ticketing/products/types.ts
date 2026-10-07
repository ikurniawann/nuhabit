import type { ReEntryPolicy } from "../masters/types";

export type TicketStatus = "draft" | "active";
export type ProductDateKind = "high-season" | "blok-online";
export type TicketProductKind = "single" | "bundle" | "season_pass";
/** EPIC-028 — kebijakan masuk season pass (dipilih saat buat produk). */
export type PassEntryPolicy = "once_per_day" | "unlimited" | "limited_visits";

export interface TicketCategory {
  id: string;
  name: string;
}

export interface TicketProductListItem {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  status: TicketStatus;
  product_kind: TicketProductKind;
  base_price: number;
  cogs: number;
  has_gate: boolean;
  thumbnail_url: string | null;
  variant_count: number;
  distributed_channels: string[];
  updated_at: string;
}

export interface TicketVariant {
  id: string;
  code: string;
  name: string;
  price_regular: number | null;
  price_high: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface TicketProductDate {
  id: string;
  date_kind: ProductDateKind;
  label: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface TicketProductChannel {
  id: string;
  channel_code: string;
  channel_name: string;
  is_online: boolean;
  is_distributed: boolean;
}

/** Fase P — satu baris komposisi paket (varian komponen × qty). */
export interface TicketBundleItem {
  id: string;
  component_variant_id: string;
  qty: number;
  sort_order: number;
  component_product_id: string;
  component_code: string;
  product_name: string;
  variant_name: string;
  component_status: TicketStatus;
  variant_is_active: boolean;
  price_regular: number | null;
  price_high: number | null;
}

export interface TicketProductDetail {
  product: {
    id: string;
    code: string;
    name: string;
    category_id: string | null;
    category_name: string | null;
    status: TicketStatus;
    product_kind: TicketProductKind;
    base_price: number;
    cogs: number;
    has_gate: boolean;
    thumbnail_url: string | null;
    description: string | null;
    re_entry_policy: ReEntryPolicy;
    created_at: string;
    updated_at: string;
  };
  variants: TicketVariant[];
  dates: TicketProductDate[];
  channels: TicketProductChannel[];
  bundle_items: TicketBundleItem[];
}

export type TicketVariantPreset = "adult-child" | "umum";

export interface CreateTicketValues {
  name: string;
  product_kind?: TicketProductKind;
  /** Tiket satuan: Adult/Child atau satu varian "Umum" semua umur. */
  variant_preset?: TicketVariantPreset;
  category_id?: string | null;
  category_name?: string | null;
  status?: TicketStatus;
  base_price?: number;
  cogs?: number;
  has_gate?: boolean;
  description?: string | null;
  /** EPIC-028 — hanya untuk product_kind 'season_pass'. */
  validity_months?: number;
  entry_policy?: PassEntryPolicy;
  visit_quota?: number | null;
  member_discount_percent?: number;
}

export interface UpdateTicketValues {
  name?: string;
  category_id?: string | null;
  category_name?: string | null;
  status?: TicketStatus;
  base_price?: number;
  cogs?: number;
  has_gate?: boolean;
  description?: string | null;
  re_entry_policy?: ReEntryPolicy;
  variants?: {
    id: string;
    name?: string;
    price_regular?: number | null;
    price_high?: number | null;
    is_active?: boolean;
  }[];
}

export interface CreateDateValues {
  date_kind: ProductDateKind;
  label: string;
  start_date: string;
  end_date: string;
}

export interface ChannelOverride {
  variant_id: string;
  price_regular: number | null;
  price_high: number | null;
}

export interface ChannelManagerChannel {
  channel_id: string;
  channel_code: string;
  channel_name: string;
  is_online: boolean;
  is_distributed: boolean;
  price_complete: boolean;
  overrides: ChannelOverride[];
}

export interface ChannelManagerItem {
  id: string;
  code: string;
  name: string;
  status: TicketStatus;
  product_kind: TicketProductKind;
  thumbnail_url: string | null;
  variants: {
    id: string;
    name: string;
    price_regular: number | null;
    price_high: number | null;
  }[];
  channels: ChannelManagerChannel[];
}

export interface LoketOption {
  variant_id: string;
  variant_name: string;
  ticket_product_id: string;
  ticket_code: string;
  ticket_name: string;
  /** Loket hanya menjual tiket satuan & paket (season pass lewat menu Pass). */
  product_kind: "single" | "bundle";
  price_regular: number | null;
  price_high: number | null;
  /** Fase P — komposisi paket (kosong utk tiket satuan). */
  members: { component_variant_id: string; qty: number; label: string }[];
  /** Jumlah gelang yang dibutuhkan per 1 unit paket (0 utk satuan). */
  members_per_unit: number;
}
