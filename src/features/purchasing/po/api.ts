import { listSuppliers } from "@/lib/purchasing/api-client/suppliers";
import { listRawMaterials } from "@/lib/purchasing/api-client/raw-materials";
import { listUnits } from "@/lib/purchasing/api-client/units";
import type { Supplier, RawMaterialWithStock, Unit } from "@/types/purchasing";

export {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  getPurchaseOrderPaymentTerms,
  createVendorPayment,
} from "@/lib/purchasing/api-client/purchase-orders";

export interface POFormData {
  suppliers: Supplier[];
  materials: RawMaterialWithStock[];
  units: Unit[];
}

/**
 * Data pendukung form PO. Tiap sumber diambil terpisah dan kegagalannya ditoleransi
 * (daftar kosong) supaya form tetap bisa dipakai.
 */
export async function getPOFormData(): Promise<POFormData> {
  const [suppliers, materialsRes, unitsRes] = await Promise.all([
    listSuppliers().catch(() => [] as Supplier[]),
    listRawMaterials({ limit: 100, is_active: undefined }).catch(() => ({ data: [] as RawMaterialWithStock[] })),
    listUnits().catch(() => ({ data: [] as Unit[] })),
  ]);

  return {
    suppliers,
    materials: materialsRes.data || [],
    units: unitsRes?.data || [],
  };
}
