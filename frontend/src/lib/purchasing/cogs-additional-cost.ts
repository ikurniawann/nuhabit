import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import {
  ADDITIONAL_COST_REFERENCE_TYPES,
  ADDITIONAL_COST_TYPES,
  type AdditionalCost,
} from "@/lib/purchasing/cogs-additional-cost-ui";

/*
 * Biaya tambahan pembelian (freight, bea masuk, handling, ...) per PO atau GRN
 * di purchasing.cogs_additional_costs. Biaya dialokasikan ke baris yang
 * diterima menurut nilai saat COGS diestimasi; tidak ada alokasi tersimpan.
 * Sama dengan Go: internal/modules/inventory/production/additional_costs.go
 * dan domain/landed_cost.go.
 */

export const additionalCostSchema = z.object({
  reference_type: z.enum(ADDITIONAL_COST_REFERENCE_TYPES),
  reference_id: z.string().uuid(),
  tipe_biaya: z.enum(ADDITIONAL_COST_TYPES),
  jumlah: z.number().positive("Jumlah harus positif"),
  currency: z.string().min(3).max(3).default("IDR"),
  exchange_rate: z.number().positive("Kurs harus positif").default(1),
  deskripsi: z.string().optional(),
  tanggal_transaksi: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
    .optional(),
  catatan: z.string().optional(),
});

export type AdditionalCostInput = z.infer<typeof additionalCostSchema>;

/** created_at is a Date here; the JSON body carries its ISO string. */
export type AdditionalCostRow = Omit<AdditionalCost, "created_at"> & { created_at: Date };

// ── Landed cost (pure) ──────────────────────────────────────────────────────

/** Baris GRN yang diterima untuk satu bahan baku: qty diterima × harga PO. */
export interface ReceiptLine {
  grn_id: string;
  po_id: string;
  material_id: string;
  value: number;
}

export interface LandedCost {
  reference_type: string;
  reference_id: string;
  amount: number;
}

const docKey = (type: string, id: string) => `${type}:${id}`;

/**
 * Tarif landed cost per bahan baku: biaya yang dialokasikan ke bahan itu
 * dibagi total nilai penerimaannya. Total dokumen (docTotals) mencakup semua
 * baris yang diterima, jadi item lain ikut menanggung bagiannya. Biaya pada
 * dokumen tanpa penerimaan tidak dialokasikan.
 */
export function landedCostRates(
  costs: LandedCost[],
  lines: ReceiptLine[],
  docTotals: Map<string, number>
): Map<string, number> {
  const purchased = new Map<string, number>();
  const byDoc = new Map<string, Map<string, number>>();
  const add = (doc: string, material: string, value: number) => {
    const materials = byDoc.get(doc) ?? new Map<string, number>();
    materials.set(material, (materials.get(material) ?? 0) + value);
    byDoc.set(doc, materials);
  };
  for (const line of lines) {
    purchased.set(line.material_id, (purchased.get(line.material_id) ?? 0) + line.value);
    add(docKey("GRN", line.grn_id), line.material_id, line.value);
    add(docKey("PO", line.po_id), line.material_id, line.value);
  }
  const allocated = new Map<string, number>();
  for (const cost of costs) {
    const key = docKey(cost.reference_type, cost.reference_id);
    const total = docTotals.get(key) ?? 0;
    if (total <= 0) continue;
    for (const [material, value] of byDoc.get(key) ?? []) {
      allocated.set(material, (allocated.get(material) ?? 0) + (cost.amount * value) / total);
    }
  }
  const rates = new Map<string, number>();
  for (const [material, amount] of allocated) {
    const bought = purchased.get(material) ?? 0;
    if (bought > 0 && amount > 0) rates.set(material, amount / bought);
  }
  return rates;
}

export function landedCostIdr(amount: number, exchangeRate: number) {
  return Math.round(amount * exchangeRate * 100) / 100;
}

// ── Procurement reads ───────────────────────────────────────────────────────

const RECEIPT_VALUE = "(gi.qty_diterima * poi.harga_satuan)::float8";
const RECEIPT_FROM = `
  FROM purchasing.grn_items gi
  JOIN purchasing.grn g ON g.id = gi.grn_id AND g.is_active = true
  JOIN purchasing.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
 WHERE gi.is_active = true`;

/** Baris GRN bahan-bahan ini plus total nilai tiap GRN dan PO-nya. */
async function loadReceivedValues(materialIds: string[]) {
  const lines = await query<ReceiptLine & Record<string, unknown>>(
    `SELECT gi.grn_id::text AS grn_id, g.purchase_order_id::text AS po_id, gi.raw_material_id::text AS material_id,
            ${RECEIPT_VALUE} AS value ${RECEIPT_FROM} AND gi.raw_material_id = ANY($1::uuid[])`,
    [materialIds]
  );
  const totals = new Map<string, number>();
  if (lines.length === 0) return { lines, totals };
  const rows = await query<{ key: string; value: number }>(
    `SELECT 'GRN:' || gi.grn_id::text AS key, sum(${RECEIPT_VALUE}) AS value ${RECEIPT_FROM}
        AND gi.grn_id = ANY($1::uuid[]) GROUP BY gi.grn_id
     UNION ALL
     SELECT 'PO:' || g.purchase_order_id::text AS key, sum(${RECEIPT_VALUE}) AS value ${RECEIPT_FROM}
        AND g.purchase_order_id = ANY($2::uuid[]) GROUP BY g.purchase_order_id`,
    [lines.map((line) => line.grn_id), lines.map((line) => line.po_id)]
  );
  for (const row of rows) totals.set(row.key, Number(row.value));
  return { lines, totals };
}

/** Nomor PO/GRN yang ada di antara refs, dengan key docKey. */
async function loadDocumentNumbers(refs: Array<{ type: string; id: string }>) {
  const rows = await query<{ key: string; number: string }>(
    `SELECT 'PO:' || id::text AS key, nomor_po AS number FROM purchasing.purchase_orders
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
     UNION ALL
     SELECT 'GRN:' || id::text AS key, nomor_grn AS number FROM purchasing.grn
      WHERE id = ANY($2::uuid[]) AND is_active = true`,
    [refs.filter((ref) => ref.type === "PO").map((ref) => ref.id), refs.filter((ref) => ref.type !== "PO").map((ref) => ref.id)]
  );
  return new Map(rows.map((row) => [row.key, row.number]));
}

/** Tarif landed cost bahan-bahan BOM dari biaya aktif di dokumen penerimaannya. */
export async function loadLandedRates(materialIds: string[]) {
  if (materialIds.length === 0) return new Map<string, number>();
  const { lines, totals } = await loadReceivedValues(materialIds);
  if (lines.length === 0) return new Map<string, number>();
  const costs = await query<LandedCost>(
    `SELECT reference_type, reference_id::text AS reference_id,
            COALESCE(jumlah_idr, round(jumlah * COALESCE(exchange_rate, 1), 2))::float8 AS amount
       FROM purchasing.cogs_additional_costs
      WHERE is_active = true AND ((reference_type = 'GRN' AND reference_id = ANY($1::uuid[]))
         OR (reference_type = 'PO' AND reference_id = ANY($2::uuid[])))`,
    [lines.map((line) => line.grn_id), lines.map((line) => line.po_id)]
  );
  return landedCostRates(costs, lines, totals);
}

// ── Store ───────────────────────────────────────────────────────────────────

const ADDITIONAL_COST_SELECT = `SELECT c.id, c.reference_type, c.reference_id, c.tipe_biaya, c.deskripsi, c.jumlah, c.currency,
       c.exchange_rate, c.jumlah_idr, c.tanggal_transaksi::text AS tanggal_transaksi, c.catatan, c.created_at,
       u.full_name AS created_by_name
  FROM purchasing.cogs_additional_costs c
  LEFT JOIN configuration.users u ON u.id = c.created_by
 WHERE c.is_active = true`;

type StoredCost = Omit<AdditionalCostRow, "reference_number">;

async function readCosts(where: string[], params: unknown[]): Promise<AdditionalCostRow[]> {
  const rows = await query<StoredCost & Record<string, unknown>>(
    `${ADDITIONAL_COST_SELECT}${where.map((w) => ` AND ${w}`).join("")} ORDER BY c.tanggal_transaksi DESC, c.created_at DESC`,
    params
  );
  if (rows.length === 0) return [];
  const numbers = await loadDocumentNumbers(rows.map((row) => ({ type: row.reference_type, id: row.reference_id })));
  return rows.map((row) => ({
    id: row.id,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    reference_number: numbers.get(docKey(row.reference_type, row.reference_id)) ?? null,
    tipe_biaya: row.tipe_biaya,
    deskripsi: row.deskripsi,
    jumlah: row.jumlah,
    currency: row.currency,
    exchange_rate: row.exchange_rate,
    jumlah_idr: row.jumlah_idr,
    tanggal_transaksi: row.tanggal_transaksi,
    catatan: row.catatan,
    created_at: row.created_at,
    created_by_name: row.created_by_name,
  }));
}

export interface AdditionalCostFilters {
  reference_type: string | null;
  reference_id: string | null;
  tipe_biaya: string | null;
}

const UUID = z.string().uuid();

export async function listAdditionalCosts(filters: AdditionalCostFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.reference_type) {
    if (!(ADDITIONAL_COST_REFERENCE_TYPES as readonly string[]).includes(filters.reference_type)) {
      throw ApiError.badRequest("reference_type tidak valid");
    }
    params.push(filters.reference_type);
    where.push(`c.reference_type = $${params.length}`);
  }
  if (filters.reference_id) {
    if (!UUID.safeParse(filters.reference_id).success) throw ApiError.badRequest("reference_id tidak valid");
    params.push(filters.reference_id);
    where.push(`c.reference_id = $${params.length}::uuid`);
  }
  if (filters.tipe_biaya) {
    params.push(filters.tipe_biaya);
    where.push(`c.tipe_biaya = $${params.length}`);
  }
  return readCosts(where, params);
}

export async function createAdditionalCost(userId: string, input: AdditionalCostInput) {
  const numbers = await loadDocumentNumbers([{ type: input.reference_type, id: input.reference_id }]);
  if (!numbers.has(docKey(input.reference_type, input.reference_id))) {
    throw ApiError.notFound(`${input.reference_type} tidak ditemukan`);
  }
  const [{ id }] = await query<{ id: string }>(
    `INSERT INTO purchasing.cogs_additional_costs (reference_type, reference_id, tipe_biaya, deskripsi,
       jumlah, currency, exchange_rate, jumlah_idr, tanggal_transaksi, catatan, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10, $11, $11) RETURNING id::text AS id`,
    [
      input.reference_type,
      input.reference_id,
      input.tipe_biaya,
      input.deskripsi ?? null,
      input.jumlah,
      input.currency,
      input.exchange_rate,
      landedCostIdr(input.jumlah, input.exchange_rate),
      input.tanggal_transaksi ?? null,
      input.catatan ?? null,
      userId,
    ]
  );
  const [row] = await readCosts(["c.id = $1::uuid"], [id]);
  return row;
}

/** Soft delete; biaya yang sudah dihapus atau tidak ada → 404. */
export async function deleteAdditionalCost(userId: string, id: string) {
  const notFound = ApiError.notFound("Biaya tambahan tidak ditemukan");
  if (!UUID.safeParse(id).success) throw notFound;
  const rows = await query<{ id: string }>(
    `UPDATE purchasing.cogs_additional_costs SET is_active = false, updated_by = $2
      WHERE id = $1 AND is_active = true RETURNING id::text AS id`,
    [id, userId]
  );
  if (rows.length === 0) throw notFound;
}
