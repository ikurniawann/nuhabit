import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export const additionalCostSchema = z.object({
  po_id: z.string().uuid().optional(),
  grn_id: z.string().uuid().optional(),
  jenis_biaya: z.enum(["freight", "handling", "asuransi", "loading", "lainnya"]),
  jumlah: z.number().positive("Jumlah harus positif"),
  mata_uang: z.string().default("IDR"),
  keterangan: z.string().optional(),
  metode_alokasi: z.enum(["by_value", "by_weight", "equal"]).default("by_value"),
  items: z
    .array(
      z.object({
        po_item_id: z.string().uuid().optional(),
        grn_item_id: z.string().uuid().optional(),
        amount: z.number().positive().optional(),
      })
    )
    .optional(),
});

export type AdditionalCostInput = z.infer<typeof additionalCostSchema>;

export interface CostAllocation {
  po_item_id?: string;
  grn_item_id?: string;
  jumlah_alokasi: number;
  proportion: number;
}

type AllocationTarget = Pick<CostAllocation, "po_item_id" | "grn_item_id">;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Alokasi manual: porsi tiap baris = amount / total amount. */
export function allocateManual(items: NonNullable<AdditionalCostInput["items"]>): CostAllocation[] {
  const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  return items.map((item) => ({
    po_item_id: item.po_item_id,
    grn_item_id: item.grn_item_id,
    jumlah_alokasi: item.amount || 0,
    proportion: totalAmount > 0 ? (item.amount || 0) / totalAmount : 0,
  }));
}

/** Porsi = nilai baris / totalValue, dibulatkan ke 2 desimal. */
export function allocateByValue(
  rows: Array<{ target: AllocationTarget; value: number }>,
  totalValue: number,
  amount: number
): CostAllocation[] {
  return rows.map(({ target, value }) => {
    const proportion = totalValue > 0 ? value / totalValue : 0;
    return { ...target, jumlah_alokasi: round2(proportion * amount), proportion };
  });
}

export function allocateEqually(targets: AllocationTarget[], amount: number): CostAllocation[] {
  return targets.map((target) => ({
    ...target,
    jumlah_alokasi: round2(amount / targets.length),
    proportion: 1 / targets.length,
  }));
}

interface PoItemRow {
  id: string;
  jumlah?: Numeric;
  harga_satuan?: Numeric;
}

interface GrnItemRow {
  id: string;
  jumlah_diterima?: Numeric;
  po_item_id?: string | null;
}

const lineValue = (item: PoItemRow) => toQty(item.jumlah) * toQty(item.harga_satuan);

async function allocateToPo(db: DbClient, input: AdditionalCostInput, poId: string) {
  const { data } = await db
    .from("purchase_order_items")
    .select("id, jumlah, harga_satuan, produk_id")
    .eq("purchase_order_id", poId);
  const poItems = (data || []) as PoItemRow[];
  if (poItems.length === 0) throw ApiError.notFound("PO tidak ditemukan atau tidak memiliki items");

  if (input.metode_alokasi === "by_value") {
    const rows = poItems.map((item) => ({ target: { po_item_id: item.id }, value: lineValue(item) }));
    return allocateByValue(rows, rows.reduce((sum, row) => sum + row.value, 0), input.jumlah);
  }
  if (input.metode_alokasi === "equal") {
    return allocateEqually(poItems.map((item) => ({ po_item_id: item.id })), input.jumlah);
  }
  return [];
}

async function allocateToGrn(db: DbClient, input: AdditionalCostInput, grnId: string) {
  const { data } = await db
    .from("goods_receipt_items")
    .select("id, jumlah_diterima, po_item_id")
    .eq("goods_receipt_id", grnId);
  const grnItems = (data || []) as GrnItemRow[];
  if (grnItems.length === 0) throw ApiError.notFound("GRN tidak ditemukan");

  if (input.metode_alokasi === "by_value") {
    const { data: poData } = await db
      .from("purchase_order_items")
      .select("id, jumlah, harga_satuan")
      .in("id", grnItems.map((item) => item.po_item_id));
    const poItems = (poData || []) as PoItemRow[];
    const poItemById = new Map(poItems.map((item) => [item.id, item]));
    // Nilai baris = qty diterima x harga PO; penyebut = nilai PO penuh (perilaku lama).
    const rows = grnItems.map((item) => {
      const poItem = item.po_item_id ? poItemById.get(item.po_item_id) : undefined;
      return {
        target: { grn_item_id: item.id },
        value: poItem ? toQty(item.jumlah_diterima) * toQty(poItem.harga_satuan) : 0,
      };
    });
    return allocateByValue(rows, poItems.reduce((sum, item) => sum + lineValue(item), 0), input.jumlah);
  }
  if (input.metode_alokasi === "equal") {
    return allocateEqually(grnItems.map((item) => ({ grn_item_id: item.id })), input.jumlah);
  }
  return [];
}

const ADDITIONAL_COST_RELATIONS = `
        po:purchase_order_id(id, po_number),
        grn:goods_receipt_id(id, nomor_gr),`;

/** Simpan biaya tambahan (freight, handling, dll) dan alokasikan ke item PO/GRN. */
export async function createAdditionalCost(db: DbClient, userId: string, input: AdditionalCostInput) {
  if (!input.po_id && !input.grn_id) throw ApiError.badRequest("po_id atau grn_id wajib diisi");

  const allocations =
    input.items && input.items.length > 0
      ? allocateManual(input.items)
      : input.po_id
        ? await allocateToPo(db, input, input.po_id)
        : await allocateToGrn(db, input, input.grn_id as string);

  const { data: costRecord, error: costError } = await db
    .from("additional_costs")
    .insert({
      po_id: input.po_id,
      grn_id: input.grn_id,
      jenis_biaya: input.jenis_biaya,
      jumlah: input.jumlah,
      mata_uang: input.mata_uang,
      keterangan: input.keterangan,
      metode_alokasi: input.metode_alokasi,
      created_by: userId,
    })
    .select()
    .single();
  if (costError) throw costError;

  if (allocations.length > 0) {
    await db.from("additional_cost_allocations").insert(
      allocations.map((item) => ({
        additional_cost_id: costRecord.id,
        po_item_id: item.po_item_id || null,
        grn_item_id: item.grn_item_id || null,
        jumlah_alokasi: item.jumlah_alokasi,
        proportion: item.proportion,
      }))
    );
  }

  const { data: complete } = await db
    .from("additional_costs")
    .select(
      `*,${ADDITIONAL_COST_RELATIONS}
        allocations:additional_cost_allocations(
          *,
          po_item:po_item_id(id),
          grn_item:grn_item_id(id)
        ),
        creator:created_by(full_name)
      `
    )
    .eq("id", costRecord.id)
    .single();
  return complete;
}

export interface AdditionalCostFilters {
  po_id: string | null;
  grn_id: string | null;
  jenis_biaya: string | null;
}

export async function listAdditionalCosts(db: DbClient, filters: AdditionalCostFilters) {
  let query = db
    .from("additional_costs")
    .select(
      `*,${ADDITIONAL_COST_RELATIONS}
        creator:created_by(full_name)
      `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (filters.po_id) query = query.eq("po_id", filters.po_id);
  if (filters.grn_id) query = query.eq("grn_id", filters.grn_id);
  if (filters.jenis_biaya) query = query.eq("jenis_biaya", filters.jenis_biaya);

  const { data, error, count } = await query;
  if (error) throw error;
  return { data, total: count || 0 };
}
