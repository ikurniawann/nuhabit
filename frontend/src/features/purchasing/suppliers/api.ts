// Thin re-export of the shared purchasing supplier service so the feature
// has a self-contained data layer (matching the standard feature structure).
export {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  updateSupplierStatus,
  deactivateSupplier,
  deleteSupplier,
  getSupplierPOHistory,
  exportSuppliersCSV,
} from "@/lib/purchasing/supplier";

export type {
  Supplier,
  SupplierDetail,
  SupplierFormData,
  SupplierListParams,
} from "@/types/supplier";
