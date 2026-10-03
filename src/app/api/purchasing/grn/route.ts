import { createServerPgClient } from "@/lib/pg/create-client";
import { createPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, createdResponse, paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  generateGrnNumber,
  validateDeliveryCanReceive,
  calculateGrnTotals,
  updateDeliveryStatusAfterGrn,
  updatePOStatusAfterGrn,
  GrnStatus,
} from "@/lib/purchasing/grn";
import { toQty } from "@/lib/purchasing/utils";
import { addSupplyStockFromGrn } from "@/lib/purchasing/supply-inventory";
import { syncReceiveRejectCredits } from "@/lib/purchasing/vendor-credit-service";
import {
  buildInlineQcItemsFromCreatedGrn,
  resolveOverallQcStatus,
  submitGrnQcInspection,
} from "@/lib/purchasing/grn-qc";
import { parsePurchasingModuleType, type PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { resolveGrnItemSku } from "@/lib/purchasing/variant-po-lines";
import { grnBatchFields, resolveGrnLineBatch } from "@/lib/purchasing/grn-batch";
import { recordAuditAfterCommit, requestMeta } from "@/lib/audit";
import { validatePOCanDelivery } from "@/lib/purchasing/delivery";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  validateWarehouseForReceivingScope,
  resolveBusinessScopeFromWarehouse,
  resolveBusinessScopeByCodes,
} from "@/lib/api/scope";

// ============================================================
// Schemas
// ============================================================

const QTY_EPSILON = 0.000001;

const grnItemSchema = z.object({
  delivery_id: z.string().uuid().optional(),
  purchase_order_item_id: z.string().uuid().optional(),
  raw_material_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  supply_item_id: z.string().uuid().optional(),
  // EPIC-047 Fase 2 — SKU varian; kalau dikirim harus sama dengan milik item PO.
  pos_sku_id: z.string().uuid().optional().nullable(),
  qty_diterima: z.number().min(0, "Qty diterima minimal 0"),
  qty_ditolak: z.number().min(0, "Qty ditolak minimal 0"),
  /** QC accepted qty — defaults to qty_diterima when omitted (RM/product combined receive). */
  qty_accepted: z.number().min(0).optional(),
  /** QC rejected qty — defaults to 0 when omitted. */
  qty_rejected: z.number().min(0).optional(),
  satuan_id: z.string().uuid().optional(),
  kondisi: z.enum(["baik", "rusak", "cacat"]).default("baik"),
  catatan: z.string().optional().nullable(),
  ...grnBatchFields,
}).superRefine((item, ctx) => {
  if (!item.raw_material_id && !item.product_id && !item.supply_item_id) {
    ctx.addIssue({
      code: "custom",
      message: "Item wajib memiliki raw material, product, atau barang operasional",
      path: ["supply_item_id"],
    });
  }
});

const createGrnSchema = z.object({
  // Untuk scope raw_material/product user memilih delivery yang sudah ada.
  // Untuk scope general, delivery dibuat otomatis dari po_id (tanpa langkah delivery).
  delivery_id: z.string().uuid().optional(),
  po_id: z.string().uuid().optional(),
  module_type: z.enum(["raw_material", "product", "general"]).optional(),
  tanggal_penerimaan: z.string().optional(),
  catatan: z.string().optional(),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  items: z.array(grnItemSchema).min(1, "Minimal 1 item wajib diisi"),
}).superRefine((data, ctx) => {
  if (!data.delivery_id && !data.po_id) {
    ctx.addIssue({
      code: "custom",
      message: "Delivery atau purchase order wajib dipilih",
      path: ["delivery_id"],
    });
  }

  const moduleType = data.module_type ?? "raw_material";
  if (moduleType === "general") return;

  data.items.forEach((item, index) => {
    const received = toQty(item.qty_diterima);
    if (received <= 0) return;

    const accepted = item.qty_accepted != null ? toQty(item.qty_accepted) : received;
    const rejected = item.qty_rejected != null ? toQty(item.qty_rejected) : 0;

    if (Math.abs(accepted + rejected - received) > QTY_EPSILON) {
      ctx.addIssue({
        code: "custom",
        message: "Qty QC accepted + rejected harus sama dengan qty diterima",
        path: ["items", index, "qty_accepted"],
      });
    }
  });
});

const queryParamsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["pending", "partially_received", "received", "rejected"]).optional(),
  delivery_id: z.string().uuid().optional(),
  po_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const updateGrnSchema = z.object({
  status: z.enum(["pending", "partially_received", "received", "rejected"]).optional(),
  catatan: z.string().optional(),
  items: z.array(grnItemSchema).optional(),
});

type POQtyValidationItem = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  supply_item_id?: string | null;
  pos_sku_id?: string | null;
  qty_ordered?: number | null;
  qty_received?: number | null;
  harga_satuan?: number | null;
  raw_material?: {
    nama?: string | null;
    nama_bahan?: string | null;
  } | null;
  product?: {
    nama?: string | null;
  } | null;
};

function getMaterialLabel(item: POQtyValidationItem) {
  return (
    item.raw_material?.nama ||
    item.raw_material?.nama_bahan ||
    item.product?.nama ||
    "item ini"
  );
}

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 4,
  }).format(value);
}

function normalizeQcOnItem<T extends {
  qty_diterima: number;
  qty_accepted?: number;
  qty_rejected?: number;
}>(item: T): T & { qty_accepted: number; qty_rejected: number } {
  const received = toQty(item.qty_diterima);
  const accepted = item.qty_accepted != null ? toQty(item.qty_accepted) : received;
  const rejected =
    item.qty_rejected != null ? toQty(item.qty_rejected) : Math.max(0, received - accepted);
  return { ...item, qty_accepted: accepted, qty_rejected: rejected };
}

// ============================================================
// GET /api/purchasing/grn - List GRN
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = queryParamsSchema.parse(Object.fromEntries(searchParams));
    const { page, limit, search, status, delivery_id, po_id, date_from, date_to } = params;
    const offset = (page - 1) * limit;

    let query = db
      .from("grn")
      .select("*", { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const scope = await getApiUserScope();
    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (status) query = query.eq("status", status);
    if (delivery_id) query = query.eq("delivery_id", delivery_id);
    if (po_id) query = query.eq("purchase_order_id", po_id);
    if (date_from) query = query.gte("tanggal_penerimaan", date_from);
    if (date_to) query = query.lte("tanggal_penerimaan", date_to);
    if (search) {
      query = query.or(`nomor_grn.ilike.%${search}%,no_surat_jalan.ilike.%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Fetch related data for display
    const deliveryIds = [...new Set((data || []).map((d: any) => d.delivery_id).filter(Boolean))];
    const poIds = [...new Set((data || []).map((d: any) => d.purchase_order_id).filter(Boolean))];
    
    let deliveryMap = new Map();
    let poMap = new Map();
    
    if (deliveryIds.length > 0) {
      const { data: deliveryData } = await db
        .from("deliveries")
        .select("id, nomor_resi, no_resi")
        .in("id", deliveryIds);
      if (deliveryData) {
        deliveryMap = new Map(deliveryData.map((d: any) => [d.id, d.no_resi || d.nomor_resi]));
      }
    }
    
    if (poIds.length > 0) {
      const { data: poData } = await db
        .from("purchase_orders")
        .select("id, nomor_po")
        .in("id", poIds);
      if (poData) {
        poMap = new Map(poData.map((po: any) => [po.id, po.nomor_po]));
      }
    }

    // Fetch supplier names
    const supplierIds = [...new Set((data || []).map((d: any) => d.supplier_id).filter(Boolean))];
    let supplierMap = new Map();
    if (supplierIds.length > 0) {
      const { data: supplierData } = await db
        .from("suppliers")
        .select("id, nama_supplier")
        .in("id", supplierIds);
      if (supplierData) {
        supplierMap = new Map(supplierData.map((s: any) => [s.id, s.nama_supplier]));
      }
    }

    // Transform data
    const transformedData = (data || []).map((d: any) => ({
      id: d.id,
      nomor_grn: d.nomor_grn,
      delivery_id: d.delivery_id,
      delivery_number: deliveryMap.get(d.delivery_id) || d.delivery_id,
      po_id: d.purchase_order_id,
      po_number: poMap.get(d.purchase_order_id) || d.purchase_order_id,
      supplier_id: d.supplier_id,
      supplier_name: supplierMap.get(d.supplier_id) || "—",
      tanggal_penerimaan: d.tanggal_penerimaan,
      no_surat_jalan: d.no_surat_jalan,
      status: d.status,
      total_item_diterima: d.total_item_diterima,
      total_item_ditolak: d.total_item_ditolak,
      receive_count: d.receive_count || 1, // Penerimaan ke-berapa
      catatan: d.catatan,
      created_at: d.created_at,
    }));

    return paginatedResponse(
      transformedData,
      {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      "GRN list retrieved"
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validation failed", error.issues).toResponse();
    }
    console.error("Error fetching GRN:", error);
    return ApiError.server("Failed to fetch GRN").toResponse();
  }
}

// ============================================================
// POST /api/purchasing/grn - Create GRN
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    // Use admin client to bypass RLS for all internal PO/delivery reads
    const adminDb = createPgClient();

    const body = await request.json();
    const validated = createGrnSchema.parse(body);
    const moduleType = parsePurchasingModuleType(validated.module_type);

    // Scope general: TANPA langkah delivery manual. Delivery dibuat otomatis dari
    // PO saat penerimaan, lalu dipakai untuk membuat GRN pada jalur yang sama.
    let deliveryId = validated.delivery_id ?? null;
    let deliveryWasAutoCreated = false;
    if (!deliveryId) {
      if (moduleType !== "general" || !validated.po_id) {
        throw ApiError.badRequest("Delivery wajib dipilih untuk penerimaan ini");
      }

      const poCanDeliver = await validatePOCanDelivery(adminDb, validated.po_id);
      if (!poCanDeliver.valid) {
        throw ApiError.badRequest(poCanDeliver.errors.join(" ") || "Purchase order belum bisa diterima");
      }

      const { data: poForDelivery, error: poForDeliveryError } = await adminDb
        .from("purchase_orders")
        .select("id, vendor_id, company_id, branch_id, module_type")
        .eq("id", validated.po_id)
        .maybeSingle();

      if (poForDeliveryError || !poForDelivery) {
        throw ApiError.badRequest("Purchase order tidak ditemukan");
      }
      if (poForDelivery.module_type !== "general") {
        throw ApiError.badRequest("Penerimaan otomatis hanya untuk purchase order barang operasional");
      }

      const today = new Date().toISOString().split("T")[0];
      const { data: autoDelivery, error: autoDeliveryError } = await adminDb
        .from("deliveries")
        .insert({
          purchase_order_id: validated.po_id,
          supplier_id: null,
          vendor_id: poForDelivery.vendor_id,
          tanggal_kirim: today,
          no_surat_jalan: `AUTO-${today}`,
          tanggal_estimasi_tiba: today,
          status: "pending",
          company_id: poForDelivery.company_id ?? null,
          branch_id: poForDelivery.branch_id ?? null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (autoDeliveryError || !autoDelivery) {
        console.error("Auto delivery insert error:", autoDeliveryError);
        throw ApiError.server("Gagal menyiapkan penerimaan barang operasional");
      }
      deliveryId = autoDelivery.id as string;
      deliveryWasAutoCreated = true;
    }

    if (!deliveryId) {
      throw ApiError.badRequest("Delivery wajib dipilih untuk penerimaan ini");
    }

    // Validate delivery can be received — use adminDb to bypass RLS
    const { valid, errors, delivery, items: poItems } = await validateDeliveryCanReceive(
      adminDb,
      deliveryId
    );

    if (!delivery?.purchase_order_id) {
      throw ApiError.badRequest(errors.join("; ") || "Delivery tidak valid untuk penerimaan barang");
    }

    // EPIC-047 Fase 2 — module_type harus mengikuti PO induk delivery, bukan body
    // request. Body yang tidak mengirim module_type (default raw_material) pada GRN
    // product-PO sebelumnya menulis supplier_id DAN vendor_id null sekaligus, yang
    // melanggar constraint grn_party_check. Jalur auto-delivery general di atas
    // sudah memvalidasi poForDelivery.module_type === "general", jadi dipercaya
    // apa adanya; jalur delivery_id yang sudah ada wajib menurunkan ulang dari PO.
    let effectiveModuleType: PurchasingModuleType = moduleType;
    if (!deliveryWasAutoCreated) {
      const { data: poForModule, error: poForModuleError } = await adminDb
        .from("purchase_orders")
        .select("module_type")
        .eq("id", delivery.purchase_order_id)
        .maybeSingle();

      if (poForModuleError || !poForModule) {
        throw ApiError.badRequest("Purchase order tidak ditemukan untuk delivery ini");
      }

      const poModuleType = parsePurchasingModuleType(poForModule.module_type);
      if (validated.module_type && validated.module_type !== poModuleType) {
        throw ApiError.badRequest(
          `module_type tidak sesuai purchase order (${poModuleType})`
        );
      }
      effectiveModuleType = poModuleType;
    }

    const normalizedItems =
      effectiveModuleType === "general"
        ? validated.items
        : validated.items.map((item) => normalizeQcOnItem(item));
    // Scope general/product menerima lewat vendor; raw_material lewat supplier.
    const usesVendor = effectiveModuleType !== "raw_material";

    const scope = await getApiUserScope();

    const businessScope =
      (await resolveBusinessScopeFromWarehouse(validated.warehouse_id)) ??
      (await resolveBusinessScopeByCodes("SULU", "SULU-BANDUNG"));

    const warehouseCheck = await validateWarehouseForReceivingScope(
      validated.warehouse_id,
      scope,
      businessScope?.branch_id ?? null
    );
    if ("error" in warehouseCheck) {
      const messages: Record<typeof warehouseCheck.error, string> = {
        not_found: "Gudang tidak ditemukan",
        inactive: "Gudang tidak aktif",
        branch_mismatch: "Gudang tidak sesuai cabang yang diizinkan untuk penerimaan ini",
      };
      throw ApiError.badRequest(messages[warehouseCheck.error]);
    }

    if (businessScope) {
      const { error: poScopeError } = await adminDb
        .from("purchase_orders")
        .update({
          company_id: businessScope.company_id,
          branch_id: businessScope.branch_id,
        })
        .eq("id", delivery.purchase_order_id);

      if (poScopeError) {
        console.error("Failed to backfill PO business scope:", poScopeError);
      }

      const { error: deliveryScopeError } = await adminDb
        .from("deliveries")
        .update({
          company_id: businessScope.company_id,
          branch_id: businessScope.branch_id,
        })
        .eq("id", deliveryId);

      if (deliveryScopeError) {
        console.error("Failed to backfill delivery business scope:", deliveryScopeError);
      }
    }

    // Re-fetch PO items directly with adminDb to ensure we get data (bypass RLS)
    const { data: freshPoItems, error: freshPoItemsError } = await adminDb
      .from("purchase_order_items")
      .select(`
        id,
        raw_material_id,
        product_id,
        supply_item_id,
        pos_sku_id,
        qty_ordered,
        qty_received,
        harga_satuan
      `)
      .eq("purchase_order_id", delivery.purchase_order_id)
      .eq("is_active", true);

    if (freshPoItemsError) {
      throw ApiError.badRequest(
        freshPoItemsError.message || "Gagal memuat item PO untuk penerimaan"
      );
    }

    // Use freshPoItems as source of truth
    const effectivePoItems = (freshPoItems || poItems || []) as POQtyValidationItem[];

    if (!valid && !errors.some(e => e.includes('status'))) {
      throw ApiError.badRequest(errors.join("; "));
    }

    const processedQtyByItem = new Map<string, number>();
    for (const item of normalizedItems) {
      const key =
        item.purchase_order_item_id || item.raw_material_id || item.product_id || item.supply_item_id;
      processedQtyByItem.set(
        key!,
        (processedQtyByItem.get(key!) || 0) + item.qty_diterima + item.qty_ditolak
      );
    }

    // EPIC-047 Fase 2 — pos_sku_id per baris GRN, diwariskan dari item PO
    // yang dirujuk (indeks sejajar dengan normalizedItems, dipakai lagi saat
    // membangun grnItemsPayload di bawah).
    const resolvedPosSkuIdByIndex: (string | null)[] = new Array(normalizedItems.length).fill(null);

    normalizedItems.forEach((item, index) => {
      const key =
        item.purchase_order_item_id || item.raw_material_id || item.product_id || item.supply_item_id;

      let poItem: POQtyValidationItem | undefined;
      if (item.purchase_order_item_id) {
        poItem = effectivePoItems.find((p) => p.id === item.purchase_order_item_id);
      } else if (item.product_id) {
        // Produk ber-varian bisa punya >1 baris PO (satu per SKU) — mencocokkan
        // hanya lewat product_id jadi ambigu, GRN wajib merujuk baris PO-nya.
        const matches = effectivePoItems.filter((p) => p.product_id === item.product_id);
        if (matches.length > 1) {
          throw ApiError.badRequest(
            "Item PO ber-varian harus dirujuk lewat purchase_order_item_id"
          );
        }
        poItem = matches[0];
      } else if (item.supply_item_id) {
        poItem = effectivePoItems.find((p) => p.supply_item_id === item.supply_item_id);
      } else {
        poItem = effectivePoItems.find((p) => p.raw_material_id === item.raw_material_id);
      }

      if (!poItem) {
        throw ApiError.badRequest("Item PO tidak ditemukan untuk validasi penerimaan");
      }

      const remainingQty = Math.max(0, Number(poItem.qty_ordered || 0) - Number(poItem.qty_received || 0));
      const processedQty = processedQtyByItem.get(key!) || 0;
      if (processedQty > remainingQty + QTY_EPSILON) {
        throw ApiError.badRequest(
          `Qty ${getMaterialLabel(poItem)} melebihi sisa PO. Maksimal ${formatQty(remainingQty)}, tetapi diinput ${formatQty(processedQty)} (diterima + ditolak).`
        );
      }

      if (item.product_id) {
        const skuResolution = resolveGrnItemSku(
          { pos_sku_id: item.pos_sku_id ?? null },
          { pos_sku_id: poItem.pos_sku_id ?? null }
        );
        if (!skuResolution.ok) {
          throw ApiError.badRequest(skuResolution.error);
        }
        resolvedPosSkuIdByIndex[index] = skuResolution.pos_sku_id;
      }
    });

    // Generate GRN number
    const grnNumber = await generateGrnNumber(adminDb);

    // Calculate totals
    const totals = calculateGrnTotals(normalizedItems);

    // Count how many times this delivery has been received (receive counter)
    // IMPORTANT: Count ALL GRNs for this delivery, including the one being created
    // because we want THIS to be N+1 where N is existing count
    const { count: previousGrnCount, error: countError } = await adminDb
      .from("grn")
      .select("*", { count: "exact", head: true })
      .eq("delivery_id", deliveryId)
      .eq("is_active", true);
    
    if (countError) {
      console.error("Error counting GRNs:", countError);
    }
    
    const receiveCount = (previousGrnCount || 0) + 1; // This is the Nth receive
    console.log(`GRN receive_count: ${receiveCount} (previous: ${previousGrnCount}, delivery: ${deliveryId})`);

    // General: received immediately (no QC).
    // RM/product: start as pending, then auto-finalize QC+stock in the same request
    // (unless all items rejected at the door).
    let grnStatus: GrnStatus = effectiveModuleType === "general" ? "received" : "pending";

    if (totals.total_diterima === 0 && totals.total_ditolak > 0) {
      grnStatus = "rejected";
    }

    // Scope mengikuti gudang penerimaan (mis. Company Sulu / Cabang Sulu Bandung)
    const insertData: Record<string, unknown> = {
      nomor_grn: grnNumber,
      delivery_id: deliveryId,
      purchase_order_id: delivery.purchase_order_id,
      supplier_id: usesVendor ? null : delivery.supplier_id,
      vendor_id: usesVendor ? delivery.vendor_id : null,
      company_id: businessScope?.company_id ?? null,
      branch_id: businessScope?.branch_id ?? null,
      tanggal_penerimaan: validated.tanggal_penerimaan || new Date().toISOString().split("T")[0],
      no_surat_jalan: delivery.no_surat_jalan,
      catatan: validated.catatan || null,
      status: grnStatus,
      total_item_diterima: totals.total_diterima,
      total_item_ditolak: totals.total_ditolak,
      receive_count: receiveCount, // Track: ini penerimaan ke-berapa
      penerima_id: user.id,
      created_by: user.id,
    };

    const { data: grn, error: grnError } = await adminDb
      .from("grn")
      .insert(insertData)
      .select()
      .single();

    if (grnError) {
      console.error("GRN insert error:", grnError);
      throw ApiError.server(
        grnError.message || "Gagal menyimpan dokumen penerimaan barang"
      );
    }

    // Batch & kedaluwarsa bahan baku: tanggal kosong → tanggal terima + shelf life.
    const receivedOn = String(insertData.tanggal_penerimaan);
    const shelfMaterialIds = normalizedItems
      .map((item) => item.raw_material_id)
      .filter((id): id is string => Boolean(id));
    const { data: shelfRows } = shelfMaterialIds.length
      ? await adminDb.from("raw_materials").select("id, shelf_life_days").in("id", shelfMaterialIds)
      : { data: [] as { id: string; shelf_life_days: number | null }[] };
    const shelfLifeById = new Map(
      ((shelfRows || []) as { id: string; shelf_life_days: number | null }[]).map((row) => [
        row.id,
        row.shelf_life_days,
      ])
    );

    // Create GRN items
    const grnItemsPayload = normalizedItems.map((item, index) => ({
      grn_id: grn.id,
      delivery_id: deliveryId,
      purchase_order_item_id: item.purchase_order_item_id,
      raw_material_id: item.raw_material_id || null,
      product_id: item.product_id || null,
      supply_item_id: item.supply_item_id || null,
      pos_sku_id: resolvedPosSkuIdByIndex[index],
      qty_diterima: item.qty_diterima,
      qty_ditolak: item.qty_ditolak,
      satuan_id: item.satuan_id,
      kondisi: item.kondisi,
      catatan: item.catatan || null,
      warehouse_id: validated.warehouse_id,
      qc_status: "pending",
      ...(item.raw_material_id
        ? resolveGrnLineBatch(item, shelfLifeById.get(item.raw_material_id), receivedOn)
        : {}),
    }));

    const { data: insertedGrnItems, error: itemsError } = await adminDb
      .from("grn_items")
      .insert(grnItemsPayload)
      .select("id, purchase_order_item_id, raw_material_id, product_id, qty_diterima");

    if (itemsError) {
      console.error("GRN items insert error:", itemsError);
      throw ApiError.server(
        itemsError.message || "Gagal menyimpan item penerimaan barang"
      );
    }

    // PO item qty_received is recalculated from GRN/QC after finalize
    // (see updatePOStatusAfterGrn → recalculatePoReceivedQty).

    // EPIC-026 C1 — Posting stok riil barang operasional. Hanya untuk scope
    // general + item stockable=true; item stockable=false di-expense (tak ada stok).
    // Non-fatal: kegagalan inventory tidak membatalkan penerimaan.
    if (effectiveModuleType === "general" && grnStatus !== "rejected") {
      try {
        const supplyIds = Array.from(
          new Set(
            normalizedItems
              .filter((it) => it.supply_item_id && toQty(it.qty_diterima) > 0)
              .map((it) => it.supply_item_id as string)
          )
        );

        if (supplyIds.length > 0) {
          const { data: supplyRows } = await adminDb
            .from("supply_items")
            .select("id, stockable")
            .in("id", supplyIds);
          const stockableSet = new Set(
            (supplyRows ?? [])
              .filter((r: { stockable?: boolean }) => r.stockable === true)
              .map((r: { id: string }) => r.id)
          );

          for (const item of normalizedItems) {
            const supplyItemId = item.supply_item_id;
            const qty = toQty(item.qty_diterima);
            if (!supplyItemId || qty <= 0 || !stockableSet.has(supplyItemId)) continue;

            const poItem = effectivePoItems.find(
              (p) =>
                (item.purchase_order_item_id && p.id === item.purchase_order_item_id) ||
                p.supply_item_id === supplyItemId
            );

            await addSupplyStockFromGrn(adminDb, {
              supplyItemId,
              warehouseId: validated.warehouse_id,
              qtyReceived: qty,
              unitCost: toQty(poItem?.harga_satuan),
              grnId: grn.id,
              grnNumber,
              companyId: businessScope?.company_id ?? null,
              branchId: businessScope?.branch_id ?? null,
              userId: user.id,
            });
          }
        }
      } catch (stockErr) {
        console.error("[GRN] Supply stock posting error (non-fatal):", stockErr);
      }
    }

    // Combined receive + QC for raw_material / product: finalize QC and post stock
    // (RM inventory / product merch) in the same request. Legacy pending GRNs still
    // use POST /api/purchasing/grn/[id]/qc.
    let finalizedStatus: GrnStatus = grnStatus;
    let accountingNote: string | null = null;
    if (
      (effectiveModuleType === "raw_material" || effectiveModuleType === "product") &&
      grnStatus === "pending"
    ) {
      const qcItems = buildInlineQcItemsFromCreatedGrn({
        createdItems: insertedGrnItems || [],
        requestItems: normalizedItems.map((item) => ({
          purchase_order_item_id: item.purchase_order_item_id,
          raw_material_id: item.raw_material_id,
          product_id: item.product_id,
          qty_diterima: item.qty_diterima,
          qty_accepted: "qty_accepted" in item ? item.qty_accepted : undefined,
          qty_rejected: "qty_rejected" in item ? item.qty_rejected : undefined,
          catatan: item.catatan,
        })),
      });

      if (qcItems.length > 0) {
        try {
          const qcResult = await submitGrnQcInspection(adminDb, {
            grnId: grn.id,
            status: resolveOverallQcStatus(qcItems),
            catatan: validated.catatan || null,
            items: qcItems,
            userId: user.id,
          });
          finalizedStatus = qcResult.grnStatus;
          accountingNote = qcResult.accountingNote ?? null;
        } catch (qcErr) {
          console.error("[GRN] Inline QC finalize error:", qcErr);
          throw ApiError.server(
            qcErr instanceof Error
              ? qcErr.message
              : "Gagal menyelesaikan QC dan posting stok pada penerimaan"
          );
        }
      }
    }

    // Physical receipt recorded — mark delivery arrived.
    // After inline QC, submitGrnQcInspection already updates delivery/PO status.
    if (finalizedStatus === "pending" || effectiveModuleType === "general") {
      if (finalizedStatus !== "rejected") {
        await adminDb
          .from("deliveries")
          .update({ status: "delivered", updated_at: new Date().toISOString() })
          .eq("id", deliveryId);
      } else {
        await updateDeliveryStatusAfterGrn(adminDb, deliveryId, finalizedStatus);
      }

      if (delivery?.purchase_order_id) {
        await updatePOStatusAfterGrn(adminDb, delivery.purchase_order_id);
      }
    } else if (finalizedStatus === "rejected" && grnStatus === "rejected") {
      // Door-reject only (no QC path)
      await updateDeliveryStatusAfterGrn(adminDb, deliveryId, finalizedStatus);
      if (delivery?.purchase_order_id) {
        await updatePOStatusAfterGrn(adminDb, delivery.purchase_order_id);
      }
    }

    try {
      await syncReceiveRejectCredits(adminDb, grn.id, user.id);
    } catch (creditErr) {
      console.error("[GRN] Vendor credit sync error (non-fatal):", creditErr);
    }

    // General: post accounting here (RM/product already via submitGrnQcInspection).
    if (effectiveModuleType === "general" && finalizedStatus !== "rejected") {
      const { postGrnAccountingJournals } = await import(
        "@/lib/purchasing/accounting-posting"
      );
      const accounting = await postGrnAccountingJournals({
        db: adminDb,
        grnId: grn.id,
        userId: user.id,
      });
      accountingNote = accounting.note;
    }

    await recordAuditAfterCommit({
      actor: { id: user.id, name: user.full_name },
      action: "grn.post",
      entity: "grn",
      entityId: grn.id,
      entityLabel: grnNumber,
      after: {
        status: finalizedStatus,
        warehouse_id: validated.warehouse_id,
        purchase_order_id: delivery.purchase_order_id,
        items: grnItemsPayload.map((item) => ({
          raw_material_id: item.raw_material_id,
          product_id: item.product_id,
          supply_item_id: item.supply_item_id,
          qty_diterima: item.qty_diterima,
          qty_ditolak: item.qty_ditolak,
          batch_number: "batch_number" in item ? item.batch_number : null,
          expiry_date: "expiry_date" in item ? item.expiry_date : null,
        })),
      },
      ...requestMeta(request),
    });

    const successMessage =
      finalizedStatus === "rejected"
        ? `GRN ${grnNumber} berhasil dibuat — semua item ditolak`
        : effectiveModuleType === "general"
          ? `GRN ${grnNumber} berhasil dibuat`
          : `GRN ${grnNumber} berhasil dibuat — QC selesai dan stok sudah diperbarui`;

    const messageWithAccounting = accountingNote
      ? `${successMessage} (${accountingNote})`
      : successMessage;

    return createdResponse(
      { ...grn, status: finalizedStatus },
      messageWithAccounting
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Validasi gagal", error.issues).toResponse();
    }
    const message =
      error instanceof Error ? error.message : "Gagal membuat penerimaan barang";
    console.error("Error creating GRN:", error);
    return ApiError.server(message).toResponse();
  }
}

// ============================================================
// PATCH /api/purchasing/grn - Update GRN (bulk update not supported)
// Use /api/purchasing/grn/[id] for single updates
// ============================================================

export async function PATCH() {
  return ApiError.badRequest("Use /api/purchasing/grn/[id] for updates").toResponse();
}
