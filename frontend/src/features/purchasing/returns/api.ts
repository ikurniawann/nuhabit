import {
  listReturns,
  getReturn,
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnableItems,
  updateReturn,
  cancelReturn,
  shipReturn,
  reviseReturn,
} from "@/lib/purchasing/return";
import { listSuppliers } from "@/lib/purchasing/api-client/suppliers";
import type {
  PurchaseReturn,
  ReturnListParams,
  ReturnableItem,
  Supplier,
} from "@/types/purchasing";

export {
  listReturns,
  getReturn,
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnableItems,
  updateReturn,
  cancelReturn,
  shipReturn,
  reviseReturn,
};

export interface ReturnListResult {
  data: PurchaseReturn[];
  pagination: { page: number; total: number; total_pages: number };
}

export async function listReturnsPaged(
  params: ReturnListParams
): Promise<ReturnListResult> {
  const result = (await listReturns(params)) as {
    data?: PurchaseReturn[];
    pagination?: Partial<ReturnListResult["pagination"]>;
  };
  return {
    data: result.data || [],
    pagination: {
      page: result.pagination?.page ?? 1,
      total: result.pagination?.total ?? 0,
      total_pages: result.pagination?.total_pages ?? 1,
    },
  };
}

export interface ReturnFormData {
  suppliers: Supplier[];
  returnableItems: ReturnableItem[];
}

export interface ReturnGrnOption {
  id: string;
  nomor_grn: string;
  tanggal_penerimaan?: string | null;
  supplier_id?: string | null;
  vendor_id?: string | null;
  supplier?: { nama_supplier?: string | null } | null;
  vendor?: { name?: string | null } | null;
}

export async function listReturnGrnOptions(
  moduleType: "raw_material" | "product" | "general" = "raw_material"
): Promise<ReturnGrnOption[]> {
  const sp = new URLSearchParams();
  if (moduleType === "product") sp.set("module_type", "product");

  const response = await fetch(`/api/purchasing/returns/grn-options?${sp.toString()}`);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || result.message || "Failed to load goods receipt options");
  }

  return result.data || [];
}

export async function getReturnFormData(
  grnId?: string | null,
  excludeReturnId?: string | null
): Promise<ReturnFormData> {
  const [suppliers, returnableItems] = await Promise.all([
    listSuppliers({ is_active: true }),
    grnId
      ? getReturnableItems(grnId, excludeReturnId || undefined)
      : Promise.resolve([] as ReturnableItem[]),
  ]);
  return { suppliers, returnableItems };
}
