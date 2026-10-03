import { createPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, successResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  validateGrnTransition,
  updateDeliveryStatusAfterGrn,
  updatePOItemReceivedQty,
  updatePOStatusAfterGrn,
  GrnStatus,
} from "@/lib/purchasing/grn";
import { toQty } from "@/lib/purchasing/utils";
import type { UserRole } from "@/types";
import { syncReceiveRejectCredits } from "@/lib/purchasing/vendor-credit-service";
import { grnBatchFields } from "@/lib/purchasing/grn-batch";
import { toDateOnly } from "@/lib/inventory/batches";

const GRN_VIEW_ROLES: UserRole[] = [
  "warehouse_staff",
  "warehouse_admin",
  "purchasing_admin",
  "purchasing_staff",
  "qc_staff",
  "admin",
  "super_admin",
];

const GRN_ITEM_DETAIL_SELECT = `
  id,
  grn_id,
  delivery_id,
  purchase_order_item_id,
  raw_material_id,
  pos_sku_id,
  qty_diterima,
  qty_ditolak,
  kondisi,
  catatan,
  satuan_id,
  batch_number,
  expiry_date,
  is_active,
  created_at,
  updated_at,
  raw_material:raw_materials!raw_material_id(
    id,
    nama,
    kode,
    satuan_besar:units!satuan_besar_id(id, nama, kode)
  ),
  satuan:units!satuan_id(id, nama, kode),
  pos_sku:pos_product_skus!pos_sku_id(id, sku, name),
  purchase_order_item:purchase_order_items!purchase_order_item_id(
    id,
    qty_ordered,
    qty_received,
    harga_satuan,
    subtotal,
    satuan:units!satuan_id(id, nama, kode)
  )
`;

const grnItemUpdateSchema = z.object({
  id: z.string().uuid().optional(),
  grn_id: z.string().uuid().optional(),
  purchase_order_item_id: z.string().uuid().optional(),
  raw_material_id: z.string().uuid(),
  qty_diterima: z.number().min(0),
  qty_ditolak: z.number().min(0),
  kondisi: z.enum(["baik", "rusak", "cacat"]).default("baik"),
  catatan: z.string().optional().nullable(),
  ...grnBatchFields,
});

const updateGrnSchema = z.object({
  status: z.enum(["pending", "partially_received", "received", "rejected"]).optional(),
  catatan: z.string().optional(),
  items: z.array(grnItemUpdateSchema).optional(),
  tanggal_penerimaan: z.string().optional(),
});

const QTY_EPSILON = 0.000001;

type POQtyValidationItem = {
  id: string;
  raw_material_id: string;
  qty_ordered?: number | null;
  qty_received?: number | null;
  raw_material?: {
    nama?: string | null;
    nama_bahan?: string | null;
  } | null;
};

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

function getMaterialLabel(item: POQtyValidationItem) {
  return item.raw_material?.nama || item.raw_material?.nama_bahan || "item ini";
}

// GET /api/purchasing/grn/[id] - Get GRN detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = createPgClient(); // bypass RLS
    const { id } = await params;

    // Get GRN with items
    const { data: grn, error: grnError } = await db
      .from("grn")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (grnError || !grn) {
      return ApiError.notFound("GRN tidak ditemukan").toResponse();
    }

    // Get GRN items with raw material details
    const { data: items, error: itemsError } = await db
      .from("grn_items")
      .select(GRN_ITEM_DETAIL_SELECT)
      .eq("grn_id", id)
      .eq("is_active", true);

    if (itemsError) {
      console.error(`[GRN/${id}] Error fetching items:`, itemsError);
      return ApiError.server(itemsError.message || "Gagal memuat item penerimaan").toResponse();
    }

    // Get related data
    const [{ data: delivery }, { data: po }, { data: supplier }] = await Promise.all([
      grn.delivery_id
        ? db.from("deliveries").select("*").eq("id", grn.delivery_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("purchase_orders").select("id, nomor_po, status, tanggal_po, total").eq("id", grn.purchase_order_id).maybeSingle(),
      db.from("suppliers").select("id, nama_supplier, kode, email, telepon").eq("id", grn.supplier_id).maybeSingle(),
    ]);

    return successResponse(
      {
        ...grn,
        delivery_number: delivery?.no_resi || delivery?.nomor_resi || delivery?.no_surat_jalan,
        delivery,
        purchase_order: po,
        po_number: po?.nomor_po,
        po_status: po?.status,
        supplier_name: supplier?.nama_supplier,
        supplier,
        items: items || [],
      },
      "GRN detail retrieved"
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching GRN:", error);
    return ApiError.server("Failed to fetch GRN").toResponse();
  }
}

// PATCH /api/purchasing/grn/[id] - Update GRN status and items
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params; // Extract id at function scope
  
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = createPgClient(); // bypass RLS

    console.log(`\n=== [PATCH GRN/${id}] START ===`);

    const body = await request.json();
    console.log(`[PATCH GRN/${id}] Request body:`, JSON.stringify(body, null, 2));
    
    const validated = updateGrnSchema.parse(body);
    console.log(`[PATCH GRN/${id}] Validated:`, JSON.stringify(validated, null, 2));

    // Get current GRN
    const { data: currentGrn, error: fetchError } = await db
      .from("grn")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (fetchError || !currentGrn) {
      return ApiError.notFound("GRN tidak ditemukan").toResponse();
    }

    // Validate status transition
    if (validated.status && validated.status !== currentGrn.status) {
      validateGrnTransition(currentGrn.status as GrnStatus, validated.status);
    }

    // Get existing GRN items
    const { data: existingItems } = await db
      .from("grn_items")
      .select("*")
      .eq("grn_id", id)
      .eq("is_active", true);

    // Calculate qty changes for inventory and PO updates
    const qtyChanges: {
      raw_material_id: string;
      purchase_order_item_id?: string;
      oldQtyDiterima: number;
      newQtyDiterima: number;
      diff: number;
    }[] = [];

    // Build map of existing items
    const existingItemsMap = new Map(
      (existingItems || []).map((item) => [item.purchase_order_item_id || item.raw_material_id, item])
    );

    // Process new items from request
    if (validated.items && validated.items.length > 0) {
      for (const newItem of validated.items) {
        const existingItem = existingItemsMap.get(
          newItem.purchase_order_item_id || newItem.raw_material_id
        );
        const oldQty = existingItem?.qty_diterima || 0;
        const newQty = newItem.qty_diterima;
        const diff = newQty - oldQty;

        if (diff !== 0) {
          qtyChanges.push({
            raw_material_id: newItem.raw_material_id,
            purchase_order_item_id: newItem.purchase_order_item_id,
            oldQtyDiterima: oldQty,
            newQtyDiterima: newQty,
            diff,
          });
        }
      }
    }

    if (validated.items && validated.items.length > 0) {
      const poItemIds = validated.items
        .map((item) => item.purchase_order_item_id)
        .filter((itemId): itemId is string => Boolean(itemId));

      const { data: poItemsForValidation, error: poValidationError } = await db
        .from("purchase_order_items")
        .select(`
          id,
          raw_material_id,
          qty_ordered,
          qty_received,
          raw_material:raw_materials!raw_material_id(nama)
        `)
        .eq("purchase_order_id", currentGrn.purchase_order_id)
        .eq("is_active", true);

      if (poValidationError) throw poValidationError;

      const validationItems = (poItemsForValidation || []) as POQtyValidationItem[];

      const poItemsMap = new Map(
        validationItems.map((item) => [item.id, item])
      );
      const poItemsByMaterialMap = new Map(
        validationItems.map((item) => [item.raw_material_id, item])
      );
      const existingItemsByKey = new Map(
        (existingItems || []).map((item) => [item.purchase_order_item_id || item.raw_material_id, item])
      );

      for (const item of validated.items) {
        const key = item.purchase_order_item_id || item.raw_material_id;
        const existingItem = existingItemsByKey.get(key);
        const poItem = item.purchase_order_item_id
          ? poItemsMap.get(item.purchase_order_item_id)
          : poItemsByMaterialMap.get(item.raw_material_id);

        if (!poItem) {
          throw ApiError.badRequest("Item PO tidak ditemukan untuk validasi penerimaan");
        }

        const previousDiterima = Number(existingItem?.qty_diterima || 0);
        const previousDitolak = Number(existingItem?.qty_ditolak || 0);
        const cumulativeDiterima = Number(item.qty_diterima || 0);
        const cumulativeDitolak = Number(item.qty_ditolak || 0);
        const deltaDiterima = Math.max(0, cumulativeDiterima - previousDiterima);
        const deltaDitolak = Math.max(0, cumulativeDitolak - previousDitolak);
        const deltaProcessed = deltaDiterima + deltaDitolak;

        const remainingQty = Math.max(
          0,
          Number(poItem.qty_ordered || 0) - Number(poItem.qty_received || 0)
        );

        if (deltaProcessed > remainingQty + QTY_EPSILON) {
          throw ApiError.badRequest(
            `Qty ${getMaterialLabel(poItem)} melebihi sisa PO. Maksimal ${formatQty(remainingQty)} untuk penerimaan tambahan, tetapi diinput ${formatQty(deltaProcessed)} (diterima + ditolak).`
          );
        }
      }

      if (poItemIds.length === 0) {
        throw ApiError.badRequest("Minimal 1 item harus terhubung dengan item PO");
      }
    }

    // Update GRN header
    const updateData: {
      updated_by: string;
      updated_at: string;
      status?: GrnStatus;
      catatan?: string;
      tanggal_penerimaan?: string;
      total_item_diterima?: number;
      total_item_ditolak?: number;
    } = {
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    // Only include valid grn table columns (exclude items - handled separately)
    if (validated.status) updateData.status = validated.status;
    if (validated.catatan !== undefined) updateData.catatan = validated.catatan;
    if (validated.tanggal_penerimaan) updateData.tanggal_penerimaan = validated.tanggal_penerimaan;

    // Recalculate totals from items
    if (validated.items && validated.items.length > 0) {
      const totalDiterima = validated.items.reduce((sum, item) => sum + item.qty_diterima, 0);
      const totalDitolak = validated.items.reduce((sum, item) => sum + item.qty_ditolak, 0);
      updateData.total_item_diterima = totalDiterima;
      updateData.total_item_ditolak = totalDitolak;

      if (validated.items.every((item) => item.qty_diterima === 0) && totalDitolak > 0) {
        updateData.status = "rejected";
      } else if (totalDiterima > 0) {
        updateData.status = "pending";
      }
    }

    const hasItemChanges = qtyChanges.length > 0;
    if (hasItemChanges && currentGrn.status !== "pending") {
      const { data: existingQc } = await db
        .from("grn_qc_inspections")
        .select("id")
        .eq("grn_id", id)
        .maybeSingle();

      if (existingQc?.id) {
        await db.from("grn_qc_inspection_items").delete().eq("qc_inspection_id", existingQc.id);
        await db.from("grn_qc_inspections").delete().eq("id", existingQc.id);
      }

      updateData.status = "pending";
    }

    if (validated.items && validated.items.length > 0 && !updateData.status) {
      const totalDiterima = validated.items.reduce((sum, item) => sum + item.qty_diterima, 0);
      const totalDitolak = validated.items.reduce((sum, item) => sum + item.qty_ditolak, 0);
      if (validated.items.every((item) => item.qty_diterima === 0) && totalDitolak > 0) {
        updateData.status = "rejected";
      } else if (totalDiterima > 0) {
        updateData.status = "pending";
      }
    }

    const { data: grn, error } = await db
      .from("grn")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    console.log(`[PATCH GRN/${id}] Update result:`, { grn, error });

    if (error) {
      console.error(`[PATCH GRN/${id}] Update error:`, error);
      throw error;
    }

    // Update GRN items if provided
    if (validated.items && validated.items.length > 0) {
      console.log(`[PATCH GRN/${id}] Updating ${validated.items.length} items...`);
      
      // Delete existing items
      const { error: deleteError } = await db.from("grn_items").update({ is_active: false }).eq("grn_id", id);
      if (deleteError) {
        console.error(`[PATCH GRN/${id}] Delete items error:`, deleteError);
        throw deleteError;
      }
      console.log(`[PATCH GRN/${id}] Deleted old items`);

      // Insert new items (preserve warehouse + previously posted QC qty for delta stock posting)
      const grnItems = validated.items.map((item) => {
        const existingItem = existingItemsMap.get(
          item.purchase_order_item_id || item.raw_material_id
        );
        const existingBatch = existingItem as
          | { batch_number?: string | null; expiry_date?: string | Date | null }
          | undefined;
        return {
          grn_id: id,
          delivery_id: currentGrn.delivery_id,
          purchase_order_item_id: item.purchase_order_item_id,
          raw_material_id: item.raw_material_id,
          qty_diterima: item.qty_diterima,
          qty_ditolak: item.qty_ditolak,
          kondisi: item.kondisi,
          catatan: item.catatan || null,
          warehouse_id: existingItem?.warehouse_id ?? null,
          qc_status: "pending",
          qty_qc_posted: existingItem?.qty_qc_posted ?? 0,
          batch_number: item.batch_number?.trim() || existingBatch?.batch_number || null,
          expiry_date: item.expiry_date || toDateOnly(existingBatch?.expiry_date),
        };
      });
      
      console.log(`[PATCH GRN/${id}] Inserting items:`, JSON.stringify(grnItems, null, 2));

      const { error: itemsError } = await db.from("grn_items").insert(grnItems);
      if (itemsError) {
        console.error(`[PATCH GRN/${id}] Insert items error:`, itemsError);
        throw itemsError;
      }
      console.log(`[PATCH GRN/${id}] Inserted new items successfully`);

      // Update PO item received quantities based on qty changes
      console.log(`[PATCH GRN/${id}] Processing ${qtyChanges.length} qty changes...`);
      for (const change of qtyChanges) {
        if (change.purchase_order_item_id && change.diff !== 0) {
          console.log(`[PATCH GRN/${id}] Updating PO item ${change.purchase_order_item_id}, diff: ${change.diff}`);
          const { data: poItem, error: poError } = await db
            .from("purchase_order_items")
            .select("qty_received")
            .eq("id", change.purchase_order_item_id)
            .single();

          if (poError) {
            console.error(`[PATCH GRN/${id}] Fetch PO item error:`, poError);
            continue;
          }

          if (poItem) {
            const newQty = Math.max(0, toQty(poItem.qty_received) + toQty(change.diff));
            console.log(`[PATCH GRN/${id}] Setting qty_received to ${newQty}`);
            await updatePOItemReceivedQty(db, change.purchase_order_item_id, newQty);
          }
        }
      }
      console.log(`[PATCH GRN/${id}] PO items updated`);
    }

    if (
      updateData.status &&
      updateData.status !== "pending" &&
      currentGrn.delivery_id
    ) {
      await updateDeliveryStatusAfterGrn(db, currentGrn.delivery_id, updateData.status as GrnStatus);
    }

    // Update PO status based on received quantities
    if (currentGrn.purchase_order_id) {
      console.log(`[PATCH GRN/${id}] Updating PO status...`);
      await updatePOStatusAfterGrn(db, currentGrn.purchase_order_id);
      console.log(`[PATCH GRN/${id}] PO status updated`);
    }

    try {
      await syncReceiveRejectCredits(db, id, user.id);
    } catch (creditErr) {
      console.error(`[PATCH GRN/${id}] Vendor credit sync error (non-fatal):`, creditErr);
    }

    console.log(`[PATCH GRN/${id}] === SUCCESS ===\n`);
    return successResponse(grn, `GRN ${grn.nomor_grn} berhasil diupdate`);
  } catch (error) {
    console.error(`[PATCH GRN/${id}] === ERROR ===`);
    console.error(`[PATCH GRN/${id}] Error:`, error);
    console.error(`[PATCH GRN/${id}] Error stack:`, error instanceof Error ? error.stack : 'N/A');
    
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    
    // Return detailed error for debugging
    const errorMessage = error instanceof Error ? error.message : String(error);
    return Response.json(
      { 
        error: { 
          message: `Failed to update GRN: ${errorMessage}`,
          details: error instanceof Error ? error.stack : undefined
        } 
      },
      { status: 500 }
    );
  }
}

// DELETE /api/purchasing/grn/[id] - Soft delete GRN
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = createPgClient(); // bypass RLS
    const { id } = await params;

    // 1. Ambil GRN + items sebelum dihapus
    const { data: grn, error: grnError } = await db
      .from("grn")
      .select("*")
      .eq("id", id)
      .eq("is_active", true)
      .single();

    if (grnError || !grn) {
      return ApiError.notFound("GRN tidak ditemukan").toResponse();
    }

    const { data: grnItems } = await db
      .from("grn_items")
      .select("purchase_order_item_id, raw_material_id, qty_diterima")
      .eq("grn_id", id)
      .eq("is_active", true);

    // 2. Kurangi qty_received di PO items
    if (grnItems && grnItems.length > 0) {
      for (const item of grnItems) {
        if (item.purchase_order_item_id) {
          const { data: poItem } = await db
            .from("purchase_order_items")
            .select("qty_received")
            .eq("id", item.purchase_order_item_id)
            .single();
          if (poItem) {
            const newQty = Math.max(0, (poItem.qty_received || 0) - (item.qty_diterima || 0));
            await updatePOItemReceivedQty(db, item.purchase_order_item_id, newQty);
          }
        }
      }
    }

    // 3. Soft delete GRN dan items
    await db.from("grn_items").update({ is_active: false }).eq("grn_id", id);
    const { data: deletedGrn, error } = await db
      .from("grn")
      .update({ is_active: false, updated_by: user.id })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // 4. Update PO status
    if (grn.purchase_order_id) {
      await updatePOStatusAfterGrn(db, grn.purchase_order_id);
    }

    // 5. Kurangi inventory
    if (grnItems) {
      for (const item of grnItems) {
        if (item.qty_diterima > 0 && item.raw_material_id) {
          try {
            await removeInventoryFromGrn(
              db,
              item.raw_material_id,
              item.qty_diterima,
              id,
              grn.nomor_grn,
              user.id
            );
          } catch (invErr) {
            console.error("Inventory remove error (non-fatal):", invErr);
          }
        }
      }
    }

    return successResponse(deletedGrn, `GRN ${grn.nomor_grn} berhasil dihapus`);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error deleting GRN:", error);
    return ApiError.server("Failed to delete GRN").toResponse();
  }
}
