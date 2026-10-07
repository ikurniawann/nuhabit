import type { DbClient } from "@/lib/pg/types";

/**
 * SKU item order (owner 2026-09-04): kolom snapshot pos_order_items.product_sku
 * sering berisi UUID / "SKU-<uuid>" karena klien tidak mengirim SKU dan
 * server jatuh ke product_id. Helper ini memilih SKU yang bermakna:
 *   kode master item.products → sku pos_products → snapshot (bila bukan UUID).
 */

const UUID_RE = /^(SKU-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True bila SKU tersimpan hanyalah UUID / "SKU-<uuid>" — tidak layak tampil. */
export function isOpaqueSku(value: string | null | undefined): boolean {
  const s = String(value ?? "").trim();
  return s.length === 0 || UUID_RE.test(s);
}

/** Pure: pilih SKU tampilan dari kandidat berurutan prioritas. */
export function pickDisplaySku(input: {
  stored?: string | null;
  masterKode?: string | null;
  posSku?: string | null;
}): string | null {
  const master = String(input.masterKode ?? "").trim();
  if (master) return master;
  const pos = String(input.posSku ?? "").trim();
  if (pos && !isOpaqueSku(pos)) return pos;
  const stored = String(input.stored ?? "").trim();
  if (stored && !isOpaqueSku(stored)) return stored;
  return null;
}

/**
 * Lengkapi product_sku pada daftar item order (in-place copy) dari master
 * produk. Gagal lookup → item dikembalikan apa adanya (tampilan tidak boleh
 * gagal hanya karena SKU).
 */
export async function resolveOrderItemSkus<
  T extends { product_id?: string | null; product_sku?: string | null }
>(db: DbClient, items: T[]): Promise<T[]> {
  const ids = [...new Set(items.map((i) => i.product_id).filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return items;
  try {
    const { data: products } = await db
      .from("pos_products")
      .select("id, sku, source_product_id")
      .in("id", ids);
    const rows = (products || []) as { id: string; sku: string | null; source_product_id: string | null }[];
    const sourceIds = [...new Set(rows.map((r) => r.source_product_id).filter((v): v is string => Boolean(v)))];
    const kodeById = new Map<string, string>();
    if (sourceIds.length > 0) {
      const { data: masters } = await db
        .from("products", "item")
        .select("id, kode")
        .in("id", sourceIds);
      for (const m of (masters || []) as { id: string; kode: string | null }[]) {
        if (m.kode) kodeById.set(m.id, m.kode);
      }
    }
    const byProduct = new Map(rows.map((r) => [r.id, r]));
    return items.map((item) => {
      const p = item.product_id ? byProduct.get(item.product_id) : undefined;
      const sku = pickDisplaySku({
        stored: item.product_sku,
        masterKode: p?.source_product_id ? kodeById.get(p.source_product_id) : null,
        posSku: p?.sku,
      });
      return sku && sku !== item.product_sku ? { ...item, product_sku: sku } : item;
    });
  } catch (error) {
    console.warn("[order-item-sku] gagal resolve SKU:", error instanceof Error ? error.message : error);
    return items;
  }
}
