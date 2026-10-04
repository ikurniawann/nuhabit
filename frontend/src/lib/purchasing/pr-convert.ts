import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { effectiveBranchId, effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import { computePoTotals, sumPoLines } from "@/lib/purchasing/po-totals";
import { getPurchasePriceSuggestions } from "@/lib/purchasing/purchase-price";
import { generatePONumber } from "@/lib/purchasing/utils";

const optionalDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

export const prConvertSchema = z.object({
  supplier_id: z.string().uuid("Supplier wajib dipilih"),
  tanggal_po: optionalDateSchema,
  tanggal_kirim_estimasi: optionalDateSchema,
  catatan: z.string().optional().nullable(),
  alamat_pengiriman: z.string().optional().nullable(),
  diskon_persen: z.number().min(0).max(100).default(0),
  diskon_nominal: z.number().min(0).default(0),
  ppn_persen: z.number().min(0).max(100).default(11),
});

type PrItemRow = {
  id: string;
  raw_material_id: string | null;
  satuan_id: string | null;
  qty: number | null;
  estimated_price: number | null;
  description: string | null;
};

/**
 * Baris PO dari item PR. Harga: riwayat beli dari pemasok ini (dibulatkan)
 * bila ada, selain itu estimasi PR. Item tanpa bahan baku ditolak.
 */
export function buildPoLinesFromPr(
  poId: string,
  prItems: PrItemRow[],
  suggestedPriceByMaterial: Map<string, number>
) {
  return prItems.map((item) => {
    if (!item.raw_material_id) {
      throw ApiError.badRequest("Item PR belum terhubung ke master bahan baku");
    }
    const suggested = suggestedPriceByMaterial.get(item.raw_material_id) ?? 0;
    return {
      purchase_order_id: poId,
      pr_item_id: item.id,
      raw_material_id: item.raw_material_id,
      qty_ordered: Number(item.qty || 0),
      satuan_id: item.satuan_id,
      harga_satuan: suggested > 0 ? Math.round(suggested) : Number(item.estimated_price ?? 0),
      diskon_item: 0,
      catatan: item.description,
      is_active: true,
    };
  });
}

/**
 * PR approved (bahan baku) → PO draft. PO yang sudah ter-insert dihapus lagi
 * bila langkah berikutnya gagal sebelum PR ditandai converted.
 */
export async function convertPrToPo(
  db: DbClient,
  prId: string,
  input: z.infer<typeof prConvertSchema>,
  userId: string,
  scope: UserScope | null
) {
  const { data: pr, error: prError } = await db
    .from("purchase_requests")
    .select("id,status,converted_po_id,company_id,branch_id")
    .eq("id", prId)
    .single();
  if (prError || !pr) throw ApiError.notFound("PR tidak ditemukan");
  if (pr.status !== "approved") throw ApiError.badRequest("PR harus approved sebelum dibuatkan PO");
  if (pr.converted_po_id) throw ApiError.badRequest("PR sudah dibuatkan PO");

  const { data: prItemRows, error: prItemsError } = await db
    .from("pr_items")
    .select("id,raw_material_id,satuan_id,qty,estimated_price,description")
    .eq("pr_id", prId);
  if (prItemsError) throw prItemsError;
  const prItems = (prItemRows ?? []) as PrItemRow[];
  if (prItems.length === 0) throw ApiError.badRequest("PR tidak memiliki item");

  const suggestions = await getPurchasePriceSuggestions(
    db,
    prItems
      .filter((item) => item.raw_material_id)
      .map((item) => ({ raw_material_id: item.raw_material_id as string, satuan_id: item.satuan_id })),
    { supplierId: input.supplier_id }
  );
  const priceByMaterial = new Map(suggestions.map((s) => [s.raw_material_id, s.unit_price]));

  const { data: insertedPo, error: poInsertError } = await db
    .from("purchase_orders")
    .insert({
      nomor_po: await generatePONumber(db),
      pr_id: prId,
      supplier_id: input.supplier_id,
      company_id: pr.company_id ?? effectiveCompanyId(scope),
      branch_id: pr.branch_id ?? effectiveBranchId(scope),
      tanggal_po: input.tanggal_po || new Date().toISOString().split("T")[0],
      tanggal_kirim_estimasi: input.tanggal_kirim_estimasi || null,
      status: "draft",
      diskon_persen: input.diskon_persen,
      diskon_nominal: input.diskon_nominal,
      ppn_persen: input.ppn_persen,
      catatan: input.catatan || null,
      alamat_pengiriman: input.alamat_pengiriman || null,
      created_by: userId,
      updated_by: userId,
      is_active: true,
    })
    .select("id")
    .single();
  if (poInsertError) throw poInsertError;
  const poId = insertedPo.id as string;

  try {
    const poLines = buildPoLinesFromPr(poId, prItems, priceByMaterial);
    const { error: itemInsertError } = await db.from("purchase_order_items").insert(poLines);
    if (itemInsertError) throw itemInsertError;

    const totals = computePoTotals(sumPoLines(poLines), input);
    const { error: updatePoError } = await db
      .from("purchase_orders")
      .update({ ...totals, updated_at: new Date().toISOString() })
      .eq("id", poId);
    if (updatePoError) throw updatePoError;

    const { error: updatePrError } = await db
      .from("purchase_requests")
      .update({ status: "converted", converted_po_id: poId, updated_at: new Date().toISOString() })
      .eq("id", prId);
    if (updatePrError) throw updatePrError;
  } catch (error) {
    try {
      await db.from("purchase_orders").delete().eq("id", poId);
    } catch (cleanupError) {
      console.error("Error cleaning up failed PO conversion:", cleanupError);
    }
    throw error;
  }

  if (suggestions.every((suggestion) => suggestion.unit_price <= 0)) {
    console.warn("PO dibuat dari PR tanpa riwayat harga pembelian; estimasi PR yang dipakai.");
  }

  const { data: po, error: poError } = await db
    .from("v_purchase_orders")
    .select("*")
    .eq("id", poId)
    .single();
  if (poError) throw poError;
  return po;
}
