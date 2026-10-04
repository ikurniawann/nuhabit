import "server-only";
// Fase P — jembatan komposisi paket ke data ber-tenant. Dipakai loket
// (registrasi), katalog booking publik, dan guard aktivasi Master Ticket.
// Eksekutor SQL disuntik supaya bisa jalan di dalam transaksi (PoolClient)
// maupun query pool biasa.

import type { PoolClient } from "pg";
import type { BundleComponentDef } from "./bundle";
import type { SeasonKind } from "./pricing";

export type SqlExec = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Adaptor PoolClient → SqlExec (untuk pemakaian di dalam withTransaction). */
export const execFromClient =
  (client: PoolClient): SqlExec =>
  async <T>(text: string, params: unknown[]) =>
    (await client.query(text, params)).rows as T[];

export interface BundleCompositionRow {
  component_variant_id: string;
  qty: number;
  product_name: string;
  variant_name: string;
  component_product_id: string;
  component_status: "draft" | "active";
  component_kind: "single" | "bundle";
  variant_is_active: boolean;
  price_regular: string | null;
  price_high: string | null;
}

/** Komposisi satu paket, terurut sort_order — ter-scope venue. */
export async function loadBundleComposition(
  exec: SqlExec,
  input: { companyId: string; branchId: string; bundleProductId: string }
): Promise<BundleCompositionRow[]> {
  return exec<BundleCompositionRow>(
    `SELECT bi.component_variant_id, bi.qty,
            tp.name AS product_name, pv.name AS variant_name,
            tp.id AS component_product_id, tp.status AS component_status,
            tp.product_kind AS component_kind,
            pv.is_active AS variant_is_active,
            pv.price_regular, pv.price_high
     FROM ticketing.ticket_bundle_items bi
     JOIN ticketing.ticket_product_variants pv
       ON pv.id = bi.component_variant_id
     JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
     WHERE bi.bundle_product_id = $1
       AND bi.branch_id = $2 AND bi.company_id = $3
     ORDER BY bi.sort_order, bi.created_at`,
    [input.bundleProductId, input.branchId, input.companyId]
  );
}

/**
 * Paket layak dijual? Null = layak; selain itu alasan (Bahasa) untuk
 * ditolak/disembunyikan. Komponen wajib: ada, produk 'single' Active,
 * varian aktif — paket-dalam-paket tertolak di sini juga (defense in
 * depth; API komposisi sudah menolak saat menyusun).
 */
export function bundleCompositionIssue(
  rows: readonly BundleCompositionRow[]
): string | null {
  if (rows.length === 0) return "Komposisi paket masih kosong";
  for (const row of rows) {
    if (row.component_kind !== "single") {
      return `Komponen "${row.product_name}" bukan tiket satuan`;
    }
    if (row.component_status !== "active") {
      return `Komponen "${row.product_name}" tidak berstatus Active`;
    }
    if (!row.variant_is_active) {
      return `Varian komponen "${row.product_name} — ${row.variant_name}" nonaktif`;
    }
  }
  return null;
}

/**
 * Komposisi → definisi komponen ber-bobot alokasi. Bobot = harga satuan
 * varian komponen pada MUSIM paket (kalender paket yang menentukan musim
 * transaksi; harga komponen hanya bobot pembagi, bukan penentu total —
 * bolong → allocateBundlePrice jatuh ke pembagian rata).
 */
export function toBundleComponents(
  rows: readonly BundleCompositionRow[],
  seasonKind: SeasonKind
): BundleComponentDef[] {
  return rows.map((row) => {
    const raw = seasonKind === "high" ? row.price_high : row.price_regular;
    return {
      component_variant_id: row.component_variant_id,
      qty: row.qty,
      product_name: row.product_name,
      variant_name: row.variant_name,
      weight_price: raw === null ? null : Number(raw),
    };
  });
}
