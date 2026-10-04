// EPIC-039 Fase A — klaim & restore stok merchandise (pola "klaim-dulu").
//
// Merchandise = pos_products.product_kind='merchandise' + inventory_tracking.
// Stoknya flat di pos_products.inventory_quantity (tanpa BOM). Klaim terjadi
// SEBELUM order dibuat: fungsi SQL pos_sell_merchandise_stock men-decrement
// atomik ber-guard (cukup stok ATAU allow_negative_stock). Produk non-merch
// dilewati oleh fungsi SQL itu sendiri ({skipped: true}) sehingga pemanggil
// tidak perlu memfilter jenis produk lebih dulu.

import type { DbClient } from "@/lib/pg/types";

/** skuId terisi = klaim per varian (Fase B); kosong = stok flat produk. */
export type MerchStockClaim = { productId: string; skuId?: string | null; qty: number };

export type MerchOrderItemInput = {
  product_id?: string | null;
  sku_id?: string | null;
  quantity?: number | string | null;
};

type SellStockResult = {
  success?: boolean;
  skipped?: boolean;
  restored?: boolean;
  reason?: string;
  quantity_after?: number;
};

type ClaimResult =
  | { ok: true; claims: MerchStockClaim[] }
  | { ok: false; status: number; reason: string };

function aggregateByProduct(items: MerchOrderItemInput[]): MerchStockClaim[] {
  const totals = new Map<string, MerchStockClaim>();
  for (const item of items) {
    const productId = String(item.product_id || "");
    const skuId = item.sku_id ? String(item.sku_id) : null;
    const qty = Number(item.quantity) || 0;
    if (!productId || qty <= 0) continue;

    const key = `${productId}::${skuId ?? ""}`;
    const existing = totals.get(key);
    if (existing) {
      totals.set(key, { ...existing, qty: existing.qty + qty });
    } else {
      totals.set(key, { productId, skuId, qty });
    }
  }
  return Array.from(totals.values());
}

/** Satu pintu ke fungsi SQL: per-SKU bila skuId ada, else per-produk. */
async function sellStockRpc(
  db: DbClient,
  claim: MerchStockClaim,
  qty: number
): Promise<{ data: SellStockResult | null; error: { message?: string } | null }> {
  if (claim.skuId) {
    const { data, error } = await db.rpc("pos_sell_merchandise_sku_stock", {
      p_sku_id: claim.skuId,
      p_qty: qty,
    });
    return { data: (data ?? null) as SellStockResult | null, error };
  }
  const { data, error } = await db.rpc("pos_sell_merchandise_stock", {
    p_product_id: claim.productId,
    p_qty: qty,
  });
  return { data: (data ?? null) as SellStockResult | null, error };
}

/**
 * Klaim stok untuk semua baris order sekaligus (agregat per produk).
 * Gagal di tengah → klaim yang sudah jadi dikembalikan sebelum return.
 */
export async function claimMerchandiseStock(
  db: DbClient,
  items: MerchOrderItemInput[]
): Promise<ClaimResult> {
  const targets = aggregateByProduct(items);
  const claims: MerchStockClaim[] = [];

  for (const target of targets) {
    const { data, error } = await sellStockRpc(db, target, target.qty);

    if (error) {
      console.error(
        `[pos] merch stock claim error: product=${target.productId} sku=${target.skuId ?? "-"}:`,
        error
      );
      await restoreMerchandiseStock(db, claims);
      return { ok: false, status: 500, reason: "Gagal memproses stok merchandise" };
    }

    const result = data ?? {};
    if (result.success === false) {
      await restoreMerchandiseStock(db, claims);
      const name = await resolveProductName(db, target.productId);
      if (result.reason === "variant_required") {
        return {
          ok: false,
          status: 400,
          reason: `${name} punya varian — pilih varian dulu sebelum dijual`,
        };
      }
      if (result.reason === "sku_not_found") {
        return {
          ok: false,
          status: 400,
          reason: `Varian ${name} tidak ditemukan/nonaktif — muat ulang katalog`,
        };
      }
      return {
        ok: false,
        status: 400,
        reason: `Stok ${name} tidak cukup untuk jumlah yang diminta`,
      };
    }

    if (!result.skipped) {
      claims.push(target);
    }
  }

  return { ok: true, claims };
}

/** Kompensasi: kembalikan stok yang sudah diklaim (idempoten via daftar klaim). */
export async function restoreMerchandiseStock(
  db: DbClient,
  claims: MerchStockClaim[]
): Promise<void> {
  for (const claim of claims) {
    const { error } = await sellStockRpc(db, claim, -claim.qty);
    if (error) {
      console.error(
        `[pos] merch stock restore failed: product=${claim.productId} sku=${claim.skuId ?? "-"} qty=${claim.qty}:`,
        error
      );
    }
  }
}

/**
 * Restore stok merchandise saat order dibatalkan: baris item ber-flag
 * inventory_deducted dikembalikan stoknya lalu flag dimatikan supaya
 * pembatalan ganda tidak mengembalikan stok dua kali.
 */
export async function restoreMerchandiseStockForOrder(
  db: DbClient,
  orderId: string
): Promise<void> {
  const { data: rows, error } = await db
    .from("pos_order_items")
    .select("id, product_id, sku_id, quantity")
    .eq("order_id", orderId)
    .eq("inventory_deducted", true);

  if (error) {
    console.error(`[pos] merch cancel-restore load failed: order=${orderId}:`, error);
    return;
  }

  type Row = { id: string; product_id: string | null; sku_id?: string | null; quantity: number | null };
  for (const row of (rows ?? []) as Row[]) {
    const qty = Number(row.quantity) || 0;
    if (!row.product_id || qty <= 0) continue;

    const { error: restoreError } = await sellStockRpc(
      db,
      { productId: row.product_id, skuId: row.sku_id ?? null, qty },
      -qty
    );
    if (restoreError) {
      console.error(
        `[pos] merch cancel-restore failed: order=${orderId} product=${row.product_id} sku=${row.sku_id ?? "-"}:`,
        restoreError
      );
      continue;
    }

    await db
      .from("pos_order_items")
      .update({ inventory_deducted: false })
      .eq("id", row.id);
  }
}

/** Ada item merchandise ber-stok di daftar? (guard fitur yang belum mendukung) */
export async function hasTrackedMerchandise(
  db: DbClient,
  items: Array<{ product_id?: string | null }>
): Promise<boolean> {
  const ids = Array.from(
    new Set(items.map((item) => String(item.product_id || "")).filter(Boolean))
  );
  if (ids.length === 0) return false;

  const { data, error } = await db
    .from("pos_products")
    .select("id")
    .in("id", ids)
    .eq("product_kind", "merchandise")
    .eq("inventory_tracking", true)
    .limit(1);

  if (error) {
    console.error("[pos] merch lookup failed:", error);
    return false;
  }
  return (data ?? []).length > 0;
}

async function resolveProductName(db: DbClient, productId: string): Promise<string> {
  const { data } = await db
    .from("pos_products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name || "produk";
}
