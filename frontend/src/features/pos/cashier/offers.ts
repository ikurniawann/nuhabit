"use client";

import { useQuery } from "@tanstack/react-query";
import type { OfferEvalRule } from "@/lib/promo/offer-evaluate";
import type { OfferType } from "@/lib/promo/offer-rules";

export type PosActiveOffer = {
  id: string;
  offer_type: OfferType;
  name: string;
  description: string | null;
  valid_from: string | null;
  valid_until: string | null;
  bundle_price: number | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_mode: string | null;
  volume_basis: string | null;
  volume_min: number | null;
  discount_type: string | null;
  discount_value: number | null;
  /** Hanya aktif setelah kode pembukanya diketik di kolom promo kasir. */
  requires_code?: boolean;
  is_exclusive?: boolean;
  items: Array<{
    role: string;
    product_id: string;
    product_name: string | null;
    qty: number;
  }>;
  eval: OfferEvalRule;
};

async function fetchActiveOffers(customerId: string | null): Promise<PosActiveOffer[]> {
  const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : "";
  const res = await fetch(`/api/pos/offer-rules${qs}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Gagal memuat promo");
  return body.data ?? [];
}

/** customerId mengisi kuota per member supaya pratinjau = hitungan server. */
export function usePosActiveOffers(enabled = true, customerId: string | null = null) {
  return useQuery({
    queryKey: ["pos", "offer-rules", "active", customerId],
    queryFn: () => fetchActiveOffers(customerId),
    enabled,
    staleTime: 60_000,
  });
}

export function offerBannerBlurb(offer: PosActiveOffer): string {
  const blurb = baseOfferBlurb(offer);
  return offer.requires_code ? `Pakai kode · ${blurb}` : blurb;
}

function baseOfferBlurb(offer: PosActiveOffer): string {
  if (offer.description?.trim()) return offer.description.trim();
  if (offer.offer_type === "bundle") {
    const comps = offer.items
      .filter((i) => i.role === "component")
      .map((i) => i.product_name || "Produk")
      .slice(0, 3)
      .join(" + ");
    const price = Number(offer.bundle_price || 0).toLocaleString("id-ID");
    return comps
      ? `${comps} · Rp ${price}`
      : `Paket spesial · Rp ${price}`;
  }
  if (offer.offer_type === "bxgy") {
    return `Beli ${offer.buy_qty} gratis ${offer.get_qty}${
      offer.get_mode === "same_as_buy" ? "" : " (item pilihan)"
    }`;
  }
  if (offer.volume_basis === "spend") {
    const disc =
      offer.discount_type === "percent"
        ? `${offer.discount_value}%`
        : `Rp ${Number(offer.discount_value || 0).toLocaleString("id-ID")}`;
    return `Min belanja Rp ${Number(offer.volume_min || 0).toLocaleString("id-ID")} · ${disc}`;
  }
  const disc =
    offer.discount_type === "percent"
      ? `${offer.discount_value}%`
      : `Rp ${Number(offer.discount_value || 0).toLocaleString("id-ID")}`;
  return `Beli ${offer.volume_min} pcs · diskon ${disc}`;
}

/** Qty produk yang ditambahkan saat banner diklik (1 set/siklus promo). */
export function planOfferQuickAdd(
  offer: PosActiveOffer
): Array<{ productId: string; qty: number; label: string }> {
  const byId = new Map<string, { productId: string; qty: number; label: string }>();
  const bump = (productId: string, qty: number, label: string) => {
    const id = String(productId || "");
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    if (!id || q <= 0) return;
    const prev = byId.get(id);
    if (prev) prev.qty += q;
    else byId.set(id, { productId: id, qty: q, label: label || "Produk" });
  };

  if (offer.offer_type === "bundle") {
    for (const item of offer.items.filter((i) => i.role === "component")) {
      bump(item.product_id, item.qty || 1, item.product_name || "Produk");
    }
    return [...byId.values()];
  }

  if (offer.offer_type === "bxgy") {
    const buyQty = Math.max(1, Math.floor(Number(offer.buy_qty) || 1));
    const getQty = Math.max(1, Math.floor(Number(offer.get_qty) || 1));
    const buyItems = offer.items.filter((i) => i.role === "buy");
    const getItems = offer.items.filter((i) => i.role === "get");
    const firstBuy = buyItems[0];
    if (!firstBuy) return [];

    if (offer.get_mode === "specific_products" && getItems.length > 0) {
      bump(firstBuy.product_id, buyQty, firstBuy.product_name || "Produk");
      // Satu siklus: get_qty dari produk get pertama (atau bagi rata sederhana)
      bump(getItems[0]!.product_id, getQty, getItems[0]!.product_name || "Produk");
    } else {
      // same_as_buy: butuh buy+get dari pool yang sama
      bump(firstBuy.product_id, buyQty + getQty, firstBuy.product_name || "Produk");
    }
    return [...byId.values()];
  }

  // volume
  const eligible = offer.items.filter((i) => i.role === "eligible");
  if (eligible.length === 0) return [];
  if (offer.volume_basis === "spend") {
    // Belum tahu harga → 1 pcs tiap eligible; kasir bisa tambah qty
    for (const item of eligible) {
      bump(item.product_id, 1, item.product_name || "Produk");
    }
    return [...byId.values()];
  }
  const minQty = Math.max(1, Math.floor(Number(offer.volume_min) || 1));
  const first = eligible[0]!;
  bump(first.product_id, minQty, first.product_name || "Produk");
  return [...byId.values()];
}

export const OFFER_BANNER_STYLE: Record<
  OfferType,
  { card: string; badge: string; label: string }
> = {
  bundle: {
    card: "border-violet-200/80 bg-violet-50",
    badge: "bg-violet-600 text-white",
    label: "Bundling",
  },
  bxgy: {
    card: "border-emerald-200/80 bg-emerald-50",
    badge: "bg-emerald-600 text-white",
    label: "Buy X Get Y",
  },
  volume: {
    card: "border-amber-200/80 bg-amber-50",
    badge: "bg-amber-600 text-white",
    label: "Diskon Volume",
  },
};
