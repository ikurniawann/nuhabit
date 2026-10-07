// Hitung ulang keranjang booking publik dari katalog SERVER (fungsi murni):
// harga & kelayakan tidak pernah dipercaya dari klien. Kuota & nama
// anggota dihitung per ORANG — 1 unit paket = beberapa orang (Fase P).

import { BOOKING_MAX_QTY, buildGuestNames } from "./booking";
import type { BundleMember } from "./bundle";

/** Bentuk minimal katalog yang dibutuhkan (lihat booking-server CatalogProduct). */
export interface CheckoutCatalogProduct {
  ticket_product_id: string;
  name: string;
  product_kind: "single" | "bundle";
  variants: {
    variant_id: string;
    variant_name: string;
    price: number;
    season_kind: string;
    members?: BundleMember[];
  }[];
}

export interface CartItemInput {
  variant_id: string;
  qty: number;
  guest_names?: (string | null)[];
}

export interface PricedCartItem extends CartItemInput {
  product_id: string;
  product_name: string;
  variant_name: string;
  price: number;
  season_kind: string;
  product_kind: "single" | "bundle";
  members: BundleMember[] | null;
  /** Jumlah ORANG per 1 qty item (paket = Σ anggota; satuan = 1). */
  persons_per_unit: number;
  subtotal: number;
}

export type PricedCart =
  | {
      ok: true;
      items: PricedCartItem[];
      /** Total orang (kuota & jumlah guest). */
      totalQty: number;
      /** Total GROSS, 2dp. */
      total: number;
      /** Nama final per posisi global (posisi 1 = pemesan). */
      guestNames: string[];
    }
  | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function priceBookingCart(
  catalog: readonly CheckoutCatalogProduct[],
  cart: readonly CartItemInput[],
  customerName: string
): PricedCart {
  const variantIndex = new Map(
    catalog.flatMap((p) =>
      p.variants.map((v) => [
        v.variant_id,
        {
          product_id: p.ticket_product_id,
          product_name: p.name,
          variant_name: v.variant_name,
          price: v.price,
          season_kind: v.season_kind,
          product_kind: p.product_kind,
          members: v.members ?? null,
        },
      ])
    )
  );

  const items: PricedCartItem[] = [];
  for (const item of cart) {
    const known = variantIndex.get(item.variant_id);
    if (!known) {
      return {
        ok: false,
        error: "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman",
      };
    }
    items.push({
      ...item,
      ...known,
      persons_per_unit: known.product_kind === "bundle" ? (known.members?.length ?? 0) : 1,
      // 2dp per baris — konvensi ledger Fase B, anti selisih float
      subtotal: round2(known.price * item.qty),
    });
  }
  if (items.some((i) => i.product_kind === "bundle" && i.persons_per_unit === 0)) {
    return {
      ok: false,
      error: "Ada paket yang tidak tersedia untuk tanggal ini — muat ulang halaman",
    };
  }

  const totalQty = items.reduce((sum, i) => sum + i.qty * i.persons_per_unit, 0);
  if (totalQty > BOOKING_MAX_QTY) {
    return { ok: false, error: `Maksimum ${BOOKING_MAX_QTY} tiket per booking` };
  }
  if (items.some((i) => (i.guest_names?.length ?? 0) > i.qty * i.persons_per_unit)) {
    return { ok: false, error: "Jumlah nama anggota melebihi jumlah tiket" };
  }

  // Urutan unit mengikuti urutan item; kosong → default posisi-global
  const guestNames = buildGuestNames(
    customerName,
    totalQty,
    items.flatMap((i) =>
      Array.from({ length: i.qty * i.persons_per_unit }, (_, k) => i.guest_names?.[k] ?? null)
    )
  );

  return {
    ok: true,
    items,
    totalQty,
    total: round2(items.reduce((sum, i) => sum + i.subtotal, 0)),
    guestNames,
  };
}
