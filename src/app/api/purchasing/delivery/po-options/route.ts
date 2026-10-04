import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope, isOperationalRowInBusinessScope } from "@/lib/api/scope";
import {
  findOpenDelivery,
  isPoEligibleForNewDelivery,
  PO_DELIVERY_ELIGIBLE_STATUSES,
} from "@/lib/purchasing/delivery";
import { parsePurchasingModuleType } from "@/lib/purchasing/module-scope";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Purchase orders eligible for creating a delivery.
 * A PO is eligible when it is approved/sent/partially received and does not have
 * an open delivery (pending/shipped/in_transit). Completed deliveries do not block
 * additional shipments for the same purchase order.
 */
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);

    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const includeAssigned = searchParams.get("include_cancelled") === "true";
    const moduleType = parsePurchasingModuleType(searchParams.get("module_type"));

    const poQuery = db
      .from("purchase_orders")
      .select("id, nomor_po, supplier_id, vendor_id, status, company_id, branch_id, created_at, module_type")
      .eq("is_active", true)
      .eq("module_type", moduleType)
      .in("status", [...PO_DELIVERY_ELIGIBLE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(500);

    const { data: purchaseOrders, error } = await poQuery;

    if (error) throw error;

    const supplierIds = [
      ...new Set((purchaseOrders || []).map((po) => po.supplier_id).filter(Boolean)),
    ] as string[];
    const vendorIds = [
      ...new Set((purchaseOrders || []).map((po) => po.vendor_id).filter(Boolean)),
    ] as string[];

    const [suppliersResult, vendorsResult] = await Promise.all([
      supplierIds.length
        ? db
            .from("suppliers")
            .select("id, nama_supplier, company_id, branch_id")
            .in("id", supplierIds)
        : Promise.resolve({ data: [], error: null }),
      vendorIds.length
        ? db
            .from("vendors")
            .select("id, name, company_id, branch_id")
            .in("id", vendorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (suppliersResult.error) throw suppliersResult.error;
    if (vendorsResult.error) throw vendorsResult.error;

    const supplierById = new Map((suppliersResult.data || []).map((supplier) => [supplier.id, supplier]));
    const vendorById = new Map((vendorsResult.data || []).map((vendor) => [vendor.id, vendor]));

    const scopedOrders = (purchaseOrders || []).filter((po) => {
      const supplier = po.supplier_id ? supplierById.get(po.supplier_id) : null;
      const vendor = po.vendor_id ? vendorById.get(po.vendor_id) : null;
      return isOperationalRowInBusinessScope(scope, {
        company_id:
          (po.company_id as string | null | undefined) ??
          (supplier?.company_id as string | null | undefined) ??
          (vendor?.company_id as string | null | undefined) ??
          null,
        branch_id:
          (po.branch_id as string | null | undefined) ??
          (supplier?.branch_id as string | null | undefined) ??
          (vendor?.branch_id as string | null | undefined) ??
          null,
      });
    });

    if (scopedOrders.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const poIds = scopedOrders.map((po) => po.id);

    const { data: deliveries, error: deliveriesError } = await db
      .from("deliveries")
      .select("id, purchase_order_id, nomor_resi, no_surat_jalan, status")
      .in("purchase_order_id", poIds)
      .eq("is_active", true)
      .neq("status", "cancelled");

    if (deliveriesError) throw deliveriesError;

    const deliveriesByPoId = new Map<string, typeof deliveries>();
    for (const delivery of deliveries || []) {
      const current = deliveriesByPoId.get(delivery.purchase_order_id) || [];
      deliveriesByPoId.set(delivery.purchase_order_id, [...current, delivery]);
    }

    const supplierNameById = new Map(
      (suppliersResult.data || []).map((supplier) => [supplier.id, supplier.nama_supplier])
    );
    const vendorNameById = new Map(
      (vendorsResult.data || []).map((vendor) => [vendor.id, vendor.name])
    );

    const mapped = scopedOrders
      .map((po) => {
        const poDeliveries = deliveriesByPoId.get(po.id) || [];
        const openDelivery = findOpenDelivery(poDeliveries);
        const latestDelivery = poDeliveries[0] ?? null;

        return {
          id: po.id,
          nomor_po: po.nomor_po,
          supplier_id: po.supplier_id,
          vendor_id: po.vendor_id,
          nama_supplier:
            moduleType === "product"
              ? vendorNameById.get(po.vendor_id) ?? null
              : supplierNameById.get(po.supplier_id) ?? null,
          status: po.status,
          active_delivery_id: openDelivery?.id ?? null,
          active_delivery_number:
            openDelivery?.nomor_resi ||
            openDelivery?.no_surat_jalan ||
            latestDelivery?.nomor_resi ||
            latestDelivery?.no_surat_jalan ||
            null,
          active_delivery_status: openDelivery?.status ?? latestDelivery?.status ?? null,
          has_open_delivery: Boolean(openDelivery),
        };
      })
      .filter((po) =>
        includeAssigned
          ? true
          : isPoEligibleForNewDelivery(
              po.status,
              (deliveriesByPoId.get(po.id) || []).map((delivery) => ({
                id: delivery.id,
                status: delivery.status,
              }))
            )
      );

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error loading delivery purchase order options:", error);
    return NextResponse.json(
      {
        success: false,
        message: getErrorMessage(error, "Failed to load purchase order options"),
      },
      { status: 500 }
    );
  }
}
