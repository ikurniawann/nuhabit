/**
 * Form penawaran (bundling, BXGY, volume) — state, reducer, payload API, dan
 * teks ringkasan tabel. Murni supaya bisa diuji tanpa React.
 */
import { parseIdrDigits } from "@/components/pos/idr-input";
import { formatNumber, formatRupiah } from "@/lib/format";
import { SALES_CHANNEL_LABELS, type SalesChannelCode } from "@/lib/pos/sales-channels";
import type {
  BxgyGetMode,
  OfferDiscountType,
  OfferItemRole,
  OfferRule,
  OfferRulePayload,
  OfferType,
  VolumeBasis,
} from "./types";

export interface OfferLimitsDraft {
  /** Kosong = semua channel. */
  sales_channels: string[];
  max_uses: string;
  max_uses_per_member: string;
  is_exclusive: boolean;
  priority: string;
  unlock_code: string;
}

export const EMPTY_OFFER_LIMITS: OfferLimitsDraft = {
  sales_channels: [],
  max_uses: "",
  max_uses_per_member: "",
  is_exclusive: false,
  priority: "0",
  unlock_code: "",
};

const toPositiveIntOrNull = (raw: string) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

export function offerLimitsPayload(draft: OfferLimitsDraft) {
  return {
    sales_channels: draft.sales_channels.length > 0 ? draft.sales_channels : null,
    max_uses: toPositiveIntOrNull(draft.max_uses),
    max_uses_per_member: toPositiveIntOrNull(draft.max_uses_per_member),
    is_exclusive: draft.is_exclusive,
    priority: Math.min(1000, Math.max(0, Math.floor(Number(draft.priority) || 0))),
    unlock_code: draft.unlock_code.trim().toUpperCase() || null,
  };
}

export type DraftItem = {
  key: string;
  role: OfferItemRole;
  kind: "product" | "category";
  product_id: string;
  category_id: string;
  qty: string;
};

export const draftTarget = (item: DraftItem) =>
  item.kind === "category" ? item.category_id : item.product_id;

export type OfferForm = {
  name: string;
  description: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  bundle_price: string;
  buy_qty: string;
  get_qty: string;
  get_mode: BxgyGetMode;
  volume_basis: VolumeBasis;
  volume_min: string;
  discount_type: OfferDiscountType;
  discount_value: string;
  items: DraftItem[];
  limits: OfferLimitsDraft;
};

/** Angka API/DB ("1000.00") → teks input bulat; 0/kosong/tidak valid → "". */
export function numberFromApi(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  return rounded > 0 ? String(rounded) : "";
}

export function emptyOfferForm(type: OfferType): OfferForm {
  return {
    name: "",
    description: "",
    valid_from: "",
    valid_until: "",
    is_active: true,
    bundle_price: "",
    buy_qty: type === "bxgy" ? "1" : "",
    get_qty: type === "bxgy" ? "1" : "",
    get_mode: "same_as_buy",
    volume_basis: "qty",
    volume_min: "",
    discount_type: "percent",
    discount_value: "",
    items: [],
    limits: EMPTY_OFFER_LIMITS,
  };
}

export function offerFormFromRule(rule: OfferRule): OfferForm {
  return {
    name: rule.name,
    description: rule.description ?? "",
    valid_from: rule.valid_from ?? "",
    valid_until: rule.valid_until ?? "",
    is_active: rule.is_active,
    bundle_price: numberFromApi(rule.bundle_price),
    buy_qty: numberFromApi(rule.buy_qty),
    get_qty: numberFromApi(rule.get_qty),
    get_mode: rule.get_mode ?? "same_as_buy",
    volume_basis: rule.volume_basis ?? "qty",
    volume_min: numberFromApi(rule.volume_min),
    discount_type: rule.discount_type ?? "percent",
    discount_value: numberFromApi(rule.discount_value),
    items: rule.items.map((item, index) => ({
      key: item.id ?? `${item.product_id ?? item.category_id}-${index}`,
      role: item.role,
      kind: item.category_id ? "category" : "product",
      product_id: item.product_id ?? "",
      category_id: item.category_id ?? "",
      qty: numberFromApi(item.qty) || "1",
    })),
    limits: {
      sales_channels: rule.sales_channels ?? [],
      max_uses: rule.max_uses != null ? String(rule.max_uses) : "",
      max_uses_per_member: rule.max_uses_per_member != null ? String(rule.max_uses_per_member) : "",
      is_exclusive: rule.is_exclusive,
      priority: String(rule.priority ?? 0),
      unlock_code: rule.unlock_code ?? "",
    },
  };
}

export type OfferFormAction =
  | { type: "patch"; patch: Partial<OfferForm> }
  | { type: "patchLimits"; patch: Partial<OfferLimitsDraft> }
  | { type: "addItem"; role: OfferItemRole; key: string }
  | { type: "patchItem"; key: string; patch: Partial<DraftItem> }
  | { type: "removeItem"; key: string };

export function offerFormReducer(state: OfferForm, action: OfferFormAction): OfferForm {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "patchLimits":
      return { ...state, limits: { ...state.limits, ...action.patch } };
    case "addItem":
      return {
        ...state,
        items: [
          ...state.items,
          { key: action.key, role: action.role, kind: "product", product_id: "", category_id: "", qty: "1" },
        ],
      };
    case "patchItem":
      return {
        ...state,
        items: state.items.map((item) => (item.key === action.key ? { ...item, ...action.patch } : item)),
      };
    case "removeItem":
      return { ...state, items: state.items.filter((item) => item.key !== action.key) };
  }
}

/** Peran item yang dipakai tiap tipe; BXGY "item sama" tidak mengirim item gratis. */
function keepsItem(type: OfferType, form: OfferForm, role: OfferItemRole): boolean {
  if (type === "bundle") return role === "component";
  if (type === "volume") return role === "eligible";
  if (role === "get") return form.get_mode !== "same_as_buy";
  return role === "buy";
}

export function buildOfferPayload(type: OfferType, form: OfferForm): OfferRulePayload {
  const items = form.items
    .filter((item) => draftTarget(item) && keepsItem(type, form, item.role))
    .map((item, index) => ({
      role: item.role,
      product_id: item.kind === "product" ? item.product_id : null,
      category_id: item.kind === "category" ? item.category_id : null,
      qty: parseIdrDigits(item.qty) || 1,
      sort_order: index,
    }));

  return {
    offer_type: type,
    name: form.name.trim(),
    description: form.description.trim() || null,
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    is_active: form.is_active,
    bundle_price: type === "bundle" ? parseIdrDigits(form.bundle_price) || 0 : null,
    buy_qty: type === "bxgy" ? parseIdrDigits(form.buy_qty) || 0 : null,
    get_qty: type === "bxgy" ? parseIdrDigits(form.get_qty) || 0 : null,
    get_mode: type === "bxgy" ? form.get_mode : null,
    volume_basis: type === "volume" ? form.volume_basis : null,
    volume_min: type === "volume" ? parseIdrDigits(form.volume_min) || 0 : null,
    discount_type: type === "volume" ? form.discount_type : null,
    discount_value: type === "volume" ? parseIdrDigits(form.discount_value) || 0 : null,
    ...offerLimitsPayload(form.limits),
    items,
  };
}

const itemLabel = (item: OfferRule["items"][number]) =>
  item.category_id ? `Kategori ${item.category_name ?? "?"}` : item.product_name ?? "Produk";

export function formatOfferWindow(rule: Pick<OfferRule, "valid_from" | "valid_until">) {
  if (!rule.valid_from && !rule.valid_until) return "Tanpa batas";
  return `${rule.valid_from ?? "…"} s/d ${rule.valid_until ?? "…"}`;
}

/** Satu baris ringkasan aturan untuk tabel. */
export function summarizeOffer(rule: OfferRule) {
  if (rule.offer_type === "bundle") {
    const comps = rule.items
      .filter((i) => i.role === "component")
      .map((i) => `${itemLabel(i)}×${Number(i.qty)}`)
      .join(" + ");
    return `${comps || "—"} → ${formatRupiah(rule.bundle_price)}`;
  }
  if (rule.offer_type === "bxgy") {
    return `Beli ${rule.buy_qty} gratis ${rule.get_qty} (${
      rule.get_mode === "specific_products" ? "item spesifik" : "item sama"
    })`;
  }
  const basis = rule.volume_basis === "spend" ? "min belanja" : "min qty";
  const disc =
    rule.discount_type === "percent" ? `${Number(rule.discount_value)}%` : formatRupiah(rule.discount_value);
  return `${basis} ${formatNumber(rule.volume_min)} → ${disc}`;
}

export type LimitBadge = { label: string; variant: "ink" | "info" | "warning" | "muted" };

/** Lencana batas & penggabungan aturan (eksklusif, prioritas, kode, kuota, channel). */
export function offerLimitBadges(rule: OfferRule): LimitBadge[] {
  const badges: LimitBadge[] = [];
  if (rule.is_exclusive) badges.push({ label: "Eksklusif", variant: "ink" });
  if (rule.priority > 0) badges.push({ label: `Prioritas ${rule.priority}`, variant: "muted" });
  if (rule.unlock_code) badges.push({ label: `Kode ${rule.unlock_code}`, variant: "info" });
  if (rule.max_uses != null) {
    badges.push({
      label: `Kuota ${rule.used_count}/${rule.max_uses}`,
      variant: rule.used_count >= rule.max_uses ? "warning" : "muted",
    });
  }
  if (rule.max_uses_per_member != null) {
    badges.push({ label: `${rule.max_uses_per_member}×/member`, variant: "muted" });
  }
  if (rule.sales_channels?.length) {
    badges.push({
      label: rule.sales_channels.map((c) => SALES_CHANNEL_LABELS[c as SalesChannelCode] ?? c).join(", "),
      variant: "muted",
    });
  }
  return badges;
}

export const OFFER_PAGE_META: Record<OfferType, { title: string; description: string; note: string }> = {
  bundle: {
    title: "Bundling",
    description: "Paket produk A+B dengan harga khusus.",
    note: "Stok & resep tetap mengikuti produk komponen (bukan stok bundle terpisah).",
  },
  bxgy: {
    title: "Buy X Get Y",
    description: "Beli X gratis Y — item sama atau produk gratis spesifik.",
    note: "Contoh: beli 1 gratis 1, beli 3 gratis 1, beli 1 gratis item A/B.",
  },
  volume: {
    title: "Diskon Volume",
    description: "Diskon setelah minimum qty atau minimum belanja.",
    note: "Contoh: beli 5 diskon 3% / Rp3.000. Kosongkan daftar produk = semua item.",
  },
};
