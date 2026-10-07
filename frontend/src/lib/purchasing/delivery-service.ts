/** Alur data delivery pembelian untuk route /api/purchasing/delivery/**. */
import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  effectiveBranchId,
  effectiveCompanyId,
  getApiUserScope,
  isOperationalRowInBusinessScope,
} from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import {
  PO_DELIVERY_ELIGIBLE_STATUSES,
  validateDeliveryTransition,
  validatePOCanDelivery,
  type DeliveryStatus,
} from "@/lib/purchasing/delivery";
import {
  buildDeliveryUpdate,
  mapDeliveryForGrn,
  mapDeliveryListRow,
  mapPoOptions,
  poBusinessScope,
  summarizeDeliveryRefs,
  type DeliveryRow,
  type PartyRow,
  type PoOptionRow,
} from "@/lib/purchasing/delivery-mappers";
import type {
  CreateDeliveryInput,
  DeliveryListQuery,
  UpdateDeliveryInput,
} from "@/lib/purchasing/delivery-schemas";
import { generateGrnNumber } from "@/lib/purchasing/grn";
import { selectByIds, uniqueIds } from "@/lib/purchasing/receiving-query";
import {
  getPurchaseOrderIdsByModuleType,
  parsePurchasingModuleType,
  type PurchasingModuleType,
} from "@/lib/purchasing/module-scope";

/** Status delivery yang bisa diterima menjadi GRN. */
const RECEIVABLE_DELIVERY_STATUSES = ["pending", "shipped", "in_transit", "delivered"];

type SupplierRow = { id: string; nama_supplier: string | null; company_id?: string | null; branch_id?: string | null };
type PoNumberRow = { id: string; nomor_po: string | null };

export async function listDeliveries(db: DbClient, params: DeliveryListQuery) {
  const { page, limit, search, status, supplier_id, vendor_id, po_id, module_type, sort_by, sort_dir } =
    params;
  const offset = (page - 1) * limit;

  let query = db.from("deliveries").select("*", { count: "exact" }).eq("is_active", true);

  const scope = await getApiUserScope();
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (module_type) {
    const poIds = await getPurchaseOrderIdsByModuleType(db, module_type);
    if (poIds.length === 0) return { data: [], total: 0 };
    query = query.in("purchase_order_id", poIds);
  }

  if (search) query = query.or(`no_surat_jalan.ilike.%${search}%,no_resi.ilike.%${search}%`);
  if (status) query = query.eq("status", status);
  if (supplier_id) query = query.eq("supplier_id", supplier_id);
  if (vendor_id) query = query.eq("vendor_id", vendor_id);
  if (po_id) query = query.eq("purchase_order_id", po_id);

  const { data, count, error } = await query
    .order(sort_by, { ascending: sort_dir === "ASC" })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data || []) as DeliveryRow[];
  const purchaseOrders = await selectByIds<PoNumberRow>(
    db,
    "purchase_orders",
    "id, nomor_po",
    uniqueIds(rows.map((row) => row.purchase_order_id))
  );
  const poNumberById = new Map(purchaseOrders.map((po) => [po.id, po.nomor_po as string]));

  return { data: rows.map((row) => mapDeliveryListRow(row, poNumberById)), total: count ?? 0 };
}

export async function createDelivery(db: DbClient, input: CreateDeliveryInput, userId: string) {
  const moduleType = parsePurchasingModuleType(input.module_type);

  const poValidation = await validatePOCanDelivery(db, input.po_id);
  if (!poValidation.valid) throw ApiError.badRequest(poValidation.errors.join(" "));

  const scope = await getApiUserScope();
  const { data: po, error: poError } = await db
    .from("purchase_orders")
    .select("company_id, branch_id, module_type, vendor_id, supplier_id")
    .eq("id", input.po_id)
    .maybeSingle();
  if (poError) throw poError;

  if (moduleType === "product" && po?.module_type !== "product") {
    throw ApiError.badRequest("Purchase order is not a product purchase order");
  }
  if (moduleType === "raw_material" && po?.module_type === "product") {
    throw ApiError.badRequest("Use product delivery flow for this purchase order");
  }

  const { data: delivery, error } = await db
    .from("deliveries")
    .insert({
      purchase_order_id: input.po_id,
      supplier_id: moduleType === "raw_material" ? input.supplier_id || po?.supplier_id : null,
      vendor_id: moduleType === "product" ? input.vendor_id || po?.vendor_id : null,
      tanggal_kirim: input.tanggal_kirim || new Date().toISOString().split("T")[0],
      no_surat_jalan: input.no_surat_jalan,
      no_resi: input.no_resi,
      kurir: input.kurir,
      tanggal_estimasi_tiba: input.tanggal_estimasi_tiba,
      status: "pending",
      catatan: input.catatan,
      company_id: po?.company_id ?? effectiveCompanyId(scope),
      branch_id: po?.branch_id ?? effectiveBranchId(scope),
      created_by: userId,
    })
    .select()
    .single();

  if (error || !delivery) {
    console.error("Error creating delivery:", error);
    throw ApiError.server("Gagal membuat delivery");
  }
  return delivery;
}

async function getDeliveryOrThrow(db: DbClient, id: string, columns = "*") {
  const { data, error } = await db.from("deliveries").select(columns).eq("id", id).single();
  if (error || !data) throw ApiError.notFound("Delivery tidak ditemukan");
  return data;
}

async function maybeRow(db: DbClient, table: string, columns: string, id: string | null | undefined) {
  if (!id) return null;
  const { data, error } = await db.from(table).select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

export async function getDeliveryDetail(db: DbClient, id: string) {
  const delivery = await getDeliveryOrThrow(db, id);
  const [supplier, vendor, purchaseOrder] = await Promise.all([
    maybeRow(db, "suppliers", "*", delivery.supplier_id),
    maybeRow(db, "vendors", "id, code, name", delivery.vendor_id),
    maybeRow(db, "purchase_orders", "*", delivery.purchase_order_id),
  ]);
  return { ...delivery, ...summarizeDeliveryRefs({ supplier, vendor, purchaseOrder }) };
}

export async function updateDelivery(db: DbClient, id: string, input: UpdateDeliveryInput, userId: string) {
  const existing = await getDeliveryOrThrow(db, id, "*, status");
  if (input.status && input.status !== existing.status) {
    validateDeliveryTransition(existing.status as DeliveryStatus, input.status);
  }

  const { data, error } = await db
    .from("deliveries")
    .update(buildDeliveryUpdate(input, userId))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Hanya delivery pending/cancelled yang boleh dihapus (soft delete). */
export async function deleteDelivery(db: DbClient, id: string, userId: string): Promise<void> {
  const existing = await getDeliveryOrThrow(db, id, "id, status");
  if (existing.status !== "pending" && existing.status !== "cancelled") {
    throw ApiError.badRequest(
      `Delivery berstatus "${existing.status}" — hanya delivery berstatus PENDING atau CANCELLED yang dapat dihapus`
    );
  }
  await db.from("deliveries").update({ is_active: false, updated_by: userId }).eq("id", id);
}

/** Tandai barang tiba lalu buat GRN pending; GRN gagal → delivery kembali in_transit. */
export async function markDeliveryArrived(db: DbClient, id: string, userId: string, notes?: string) {
  const delivery = await getDeliveryOrThrow(
    db,
    id,
    "*, purchase_order:purchase_orders!purchase_order_id(id, nomor_po, status, supplier_id, vendor_id, company_id, branch_id)"
  );
  validateDeliveryTransition(delivery.status as DeliveryStatus, "delivered");

  const arrivedOn = new Date().toISOString().split("T")[0];
  const { data: updatedDelivery, error: deliveryError } = await db
    .from("deliveries")
    .update({ status: "delivered", tanggal_aktual_tiba: arrivedOn, updated_by: userId })
    .eq("id", id)
    .select("*")
    .single();
  if (deliveryError) throw deliveryError;

  const po = delivery.purchase_order as {
    supplier_id?: string | null;
    vendor_id?: string | null;
    company_id?: string | null;
    branch_id?: string | null;
  } | null;

  const { data: grn, error: grnError } = await db
    .from("grn")
    .insert({
      nomor_grn: await generateGrnNumber(db),
      purchase_order_id: delivery.purchase_order_id,
      delivery_id: id,
      supplier_id: delivery.supplier_id || po?.supplier_id,
      vendor_id: delivery.vendor_id || po?.vendor_id || null,
      company_id: delivery.company_id ?? po?.company_id ?? null,
      branch_id: delivery.branch_id ?? po?.branch_id ?? null,
      tanggal_penerimaan: arrivedOn,
      penerima_id: userId,
      status: "pending",
      catatan: notes || null,
      created_by: userId,
    })
    .select("*, purchase_order:purchase_orders!purchase_order_id(id, nomor_po, status)")
    .single();

  if (grnError) {
    await db.from("deliveries").update({ status: "in_transit", updated_by: userId }).eq("id", id);
    throw new Error(`Failed to create GRN: ${grnError.message}`);
  }
  return { delivery: updatedDelivery, grn };
}

/**
 * PO yang bisa dibuatkan delivery: approved/sent/partially_received tanpa
 * delivery terbuka. Delivery selesai tidak memblokir pengiriman susulan.
 */
export async function listPoOptionsForDelivery(
  db: DbClient,
  moduleType: PurchasingModuleType,
  includeAssigned: boolean
) {
  const scope = await getApiUserScope();
  const { data, error } = await db
    .from("purchase_orders")
    .select("id, nomor_po, supplier_id, vendor_id, status, company_id, branch_id, created_at, module_type")
    .eq("is_active", true)
    .eq("module_type", moduleType)
    .in("status", [...PO_DELIVERY_ELIGIBLE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const orders = (data || []) as PoOptionRow[];

  const [suppliers, vendors] = await Promise.all([
    selectByIds<SupplierRow>(
      db,
      "suppliers",
      "id, nama_supplier, company_id, branch_id",
      uniqueIds(orders.map((po) => po.supplier_id))
    ),
    selectByIds<PartyRow>(db, "vendors", "id, name, company_id, branch_id", uniqueIds(orders.map((po) => po.vendor_id))),
  ]);
  const supplierById = new Map(
    suppliers.map((s): [string, PartyRow] => [s.id, { ...s, name: s.nama_supplier }])
  );
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const scopedOrders = orders.filter((po) =>
    isOperationalRowInBusinessScope(
      scope,
      poBusinessScope(
        po,
        po.supplier_id ? supplierById.get(po.supplier_id) : null,
        po.vendor_id ? vendorById.get(po.vendor_id) : null
      )
    )
  );
  if (scopedOrders.length === 0) return [];

  const { data: deliveries, error: deliveriesError } = await db
    .from("deliveries")
    .select("id, purchase_order_id, nomor_resi, no_surat_jalan, status")
    .in("purchase_order_id", scopedOrders.map((po) => po.id))
    .eq("is_active", true)
    .neq("status", "cancelled");
  if (deliveriesError) throw deliveriesError;

  const deliveriesByPoId = new Map<string, DeliveryRow[]>();
  for (const delivery of (deliveries || []) as DeliveryRow[]) {
    const current = deliveriesByPoId.get(delivery.purchase_order_id) || [];
    deliveriesByPoId.set(delivery.purchase_order_id, [...current, delivery]);
  }

  return mapPoOptions({
    orders: scopedOrders,
    deliveriesByPoId,
    supplierNameById: new Map(suppliers.map((s) => [s.id, s.nama_supplier])),
    vendorNameById: new Map(vendors.map((v) => [v.id, v.name])),
    moduleType,
    includeAssigned,
  });
}

/** Delivery aktif berstatus bisa-diterima, belum punya GRN aktif, dalam scope user. */
export async function listDeliveriesForGrn(db: DbClient, moduleType: PurchasingModuleType) {
  const scope = await getApiUserScope();
  let query = db
    .from("deliveries")
    .select("*")
    .eq("is_active", true)
    .in("status", RECEIVABLE_DELIVERY_STATUSES);

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  const poIds = await getPurchaseOrderIdsByModuleType(db, moduleType);
  if (poIds.length === 0) return [];

  const { data: deliveries, error } = await query
    .in("purchase_order_id", poIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const { data: grnRows, error: grnError } = await db
    .from("grn")
    .select("delivery_id")
    .eq("is_active", true)
    .not("delivery_id", "is", null);
  if (grnError) throw grnError;

  const deliveryIdsWithGrn = new Set(
    uniqueIds(((grnRows || []) as { delivery_id: string | null }[]).map((row) => row.delivery_id))
  );
  const eligible = ((deliveries || []) as DeliveryRow[]).filter(
    (delivery) => !deliveryIdsWithGrn.has(delivery.id)
  );

  const [suppliers, vendors, purchaseOrders] = await Promise.all([
    selectByIds<SupplierRow>(db, "suppliers", "id, nama_supplier", uniqueIds(eligible.map((d) => d.supplier_id))),
    selectByIds<PartyRow>(db, "vendors", "id, name", uniqueIds(eligible.map((d) => d.vendor_id))),
    selectByIds<PoNumberRow>(db, "purchase_orders", "id, nomor_po", uniqueIds(eligible.map((d) => d.purchase_order_id))),
  ]);

  const lookups = {
    supplierNameById: new Map(suppliers.map((s) => [s.id, s.nama_supplier || "-"])),
    vendorNameById: new Map(vendors.map((v) => [v.id, v.name || "-"])),
    poNumberById: new Map(purchaseOrders.map((po) => [po.id, po.nomor_po || "-"])),
  };
  return eligible.map((delivery) => mapDeliveryForGrn(delivery, lookups));
}
