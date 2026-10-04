// Helper murni wizard booking publik: keranjang, harga tampilan, unit
// rombongan, validasi pemesan, payload create. Harga di sini murni
// tampilan; server menghitung ulang saat POST. Aturan inti:
// 1 transaksi = SATU produk tiket, maks 20 ORANG per booking (1 unit paket
// = beberapa orang).
//
// Tanpa import runtime dari booking.ts (modul itu menarik `crypto`) supaya
// aman dipakai di bundel klien; konstanta di bawah mencerminkan
// BOOKING_MAX_QTY & BOOKING_MAX_DAYS_AHEAD server.

import type { CatalogProduct, CatalogVariant } from "./booking-server";

export type { CatalogProduct, CatalogVariant };

export const WIZARD_MAX_QTY = 20;
export const WIZARD_MAX_DAYS_AHEAD = 90;

/** Jumlah ORANG per 1 qty varian (paket = jumlah anggota; satuan = 1). */
export const personsPerUnit = (variant: CatalogVariant) =>
  variant.members?.length || 1;

/**
 * Total harga satuan anggota paket, pembanding "hemat". Null bila ada
 * bobot bolong (jangan menampilkan klaim hemat dari data tak lengkap).
 */
export function bundleStandaloneTotal(variant: CatalogVariant): number | null {
  if (!variant.members || variant.members.length === 0) return null;
  let total = 0;
  for (const member of variant.members) {
    if (member.weight_price === null) return null;
    total += member.weight_price;
  }
  return total;
}

/** Harga coret + hemat untuk paket; null bila tidak ada penghematan. */
export function bundleSaving(
  variant: CatalogVariant
): { standalone: number; saving: number } | null {
  const standalone = bundleStandaloneTotal(variant);
  if (standalone === null || standalone <= variant.price) return null;
  return { standalone, saving: standalone - variant.price };
}

/** "2× Dewasa, 1× Anak" dari anggota paket (urut kemunculan pertama). */
export function bundleContentsLabel(variant: CatalogVariant): string {
  const counts = new Map<string, number>();
  for (const m of variant.members ?? []) {
    counts.set(m.member_label, (counts.get(m.member_label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count}× ${label}`).join(", ");
}

export const variantLabelOf = (product: CatalogProduct, variant: CatalogVariant) =>
  product.product_kind === "bundle"
    ? `Paket (${variant.members?.length ?? 0} orang)`
    : variant.variant_name;

/** Harga "Mulai" kartu produk = harga varian termurah (0 bila kosong). */
export const minVariantPrice = (product: CatalogProduct) => {
  const prices = product.variants.map((v) => v.price);
  return prices.length ? Math.min(...prices) : 0;
};

export type QtyMap = Record<string, number>;

export interface CartLine {
  product: CatalogProduct;
  variant: CatalogVariant;
  qty: number;
}

/** Baris keranjang dari peta qty (urut sisip), varian tak dikenal dibuang. */
export function buildCart(catalog: readonly CatalogProduct[], qty: QtyMap): CartLine[] {
  const index = new Map<string, { product: CatalogProduct; variant: CatalogVariant }>();
  for (const product of catalog) {
    for (const variant of product.variants) {
      index.set(variant.variant_id, { product, variant });
    }
  }
  const lines: CartLine[] = [];
  for (const [variantId, n] of Object.entries(qty)) {
    const known = index.get(variantId);
    if (n > 0 && known) lines.push({ ...known, qty: n });
  }
  return lines;
}

/** Kuota & nama dihitung per ORANG. */
export const cartPersons = (cart: readonly CartLine[]) =>
  cart.reduce((sum, c) => sum + c.qty * personsPerUnit(c.variant), 0);

export const cartAmount = (cart: readonly CartLine[]) =>
  cart.reduce((sum, c) => sum + c.qty * c.variant.price, 0);

/** Yang harus dibayar = total − potongan promo (preview; server hitung ulang). */
export const payableAmount = (total: number, discount: number) =>
  Math.max(0, Math.round((total - discount) * 100) / 100);

export interface QtySelection {
  selectedProductId: string | null;
  qty: QtyMap;
}

/**
 * Ubah qty satu varian. Menaikkan qty varian produk lain menjadikan produk
 * itu terpilih dan mereset pilihan lama (radio implisit). Perubahan yang
 * melewati batas orang per booking, atau tidak mengubah apa pun, mengembalikan
 * objek `current` apa adanya.
 */
export function applyQtyChange(
  current: QtySelection,
  product: CatalogProduct,
  variant: CatalogVariant,
  delta: number
): QtySelection {
  const variantId = variant.variant_id;
  if (delta > 0 && current.selectedProductId !== product.ticket_product_id) {
    return { selectedProductId: product.ticket_product_id, qty: { [variantId]: 1 } };
  }

  // Semua entri qty milik produk terpilih, jadi cukup cari di varian produk ini
  const persons = (id: string, n: number) => {
    const known = product.variants.find((v) => v.variant_id === id);
    return known ? n * personsPerUnit(known) : n;
  };
  const next = Math.max(0, (current.qty[variantId] ?? 0) + delta);
  if (next === (current.qty[variantId] ?? 0)) return current;
  const others = Object.entries(current.qty)
    .filter(([id]) => id !== variantId)
    .reduce((sum, [id, n]) => sum + persons(id, n), 0);
  if (others + persons(variantId, next) > WIZARD_MAX_QTY) return current;
  return { ...current, qty: { ...current.qty, [variantId]: next } };
}

export interface GuestUnit {
  variantId: string;
  /** Indeks unit ORANG di dalam varian (paket meledak per anggota). */
  unitIndex: number;
  /** Posisi global 1..N; 1 = pemesan. */
  position: number;
  label: string;
}

/**
 * Unit ORANG ter-flatten urut keranjang. Urutan HARUS sama dengan flatten
 * server (item → qty → anggota) supaya nama jatuh ke orang yang benar.
 */
export function flattenGuestUnits(cart: readonly CartLine[]): GuestUnit[] {
  const units: GuestUnit[] = [];
  let position = 0;
  for (const c of cart) {
    const members = c.variant.members ?? [];
    let unitIndex = 0;
    for (let k = 0; k < c.qty; k++) {
      const labels =
        members.length > 0
          ? members.map((m) => `${c.product.name} · ${m.member_label}`)
          : [`${c.product.name} — ${c.variant.variant_name}`];
      for (const label of labels) {
        position += 1;
        units.push({ variantId: c.variant.variant_id, unitIndex: unitIndex++, position, label });
      }
    }
  }
  return units;
}

/** Placeholder nama anggota; sama dengan default server buildGuestNames. */
export function defaultGuestName(customerName: string, position: number): string {
  const base = customerName.trim() || "Anda";
  return position === 1 ? base : `Group ${base} - ${position}`;
}

const digitCount = (phone: string) => phone.replace(/\D/g, "").length;

export interface CustomerFields {
  customerName: string;
  customerPhone: string;
  isGift: boolean;
  giftName: string;
  giftPhone: string;
}

/** Nama ≥ 2 huruf, WA ≥ 8 digit; hadiah mewajibkan nama & WA penerima. */
export function isCustomerValid(f: CustomerFields): boolean {
  const giftValid =
    !f.isGift || (f.giftName.trim().length >= 2 && digitCount(f.giftPhone) >= 8);
  return f.customerName.trim().length >= 2 && digitCount(f.customerPhone) >= 8 && giftValid;
}

/** Venue ber-slot: wajib pilih slot yang masih tersedia sebelum lanjut. */
export function isSlotRequirementUnmet(
  slots: readonly { slot_id: string; status: string }[],
  selectedSlotId: string | null
): boolean {
  if (slots.length === 0) return false;
  const selected = slots.find((s) => s.slot_id === selectedSlotId);
  return !selected || selected.status === "sold_out";
}

export interface BookingCreatePayload {
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  slot_id?: string;
  promo_code?: string;
  gift_recipient_name?: string;
  gift_recipient_phone?: string;
  items: { variant_id: string; qty: number; guest_names: (string | null)[] }[];
}

export interface BookingPayloadInput extends CustomerFields {
  visitDate: string;
  selectedSlotId: string | null;
  promoCode: string | null;
  cart: readonly CartLine[];
  guestNames: Record<string, string[]>;
}

/** Body POST /api/public/booking/[slug]; nama kosong → null (default server). */
export function buildBookingPayload(input: BookingPayloadInput): BookingCreatePayload {
  return {
    visit_date: input.visitDate,
    customer_name: input.customerName.trim(),
    customer_phone: input.customerPhone.trim(),
    ...(input.selectedSlotId ? { slot_id: input.selectedSlotId } : {}),
    ...(input.promoCode ? { promo_code: input.promoCode } : {}),
    ...(input.isGift
      ? {
          gift_recipient_name: input.giftName.trim(),
          gift_recipient_phone: input.giftPhone.trim(),
        }
      : {}),
    items: input.cart.map((c) => ({
      variant_id: c.variant.variant_id,
      qty: c.qty,
      guest_names: Array.from(
        { length: c.qty * personsPerUnit(c.variant) },
        (_, k) => input.guestNames[c.variant.variant_id]?.[k]?.trim() || null
      ),
    })),
  };
}
