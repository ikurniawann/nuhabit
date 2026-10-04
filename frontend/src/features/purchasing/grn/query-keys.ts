import type { PurchasingModuleType } from "./api";
import type { GrnListParams } from "./types";

export const grnQueryKeys = {
  all: ["purchasing", "grn"] as const,
  list: (params: GrnListParams) => ["purchasing", "grn", "list", params] as const,
  detail: (id: string) => ["purchasing", "grn", "detail", id] as const,
  qc: (id: string) => ["purchasing", "grn", "qc", id] as const,
  vendorCredits: (id: string) => ["purchasing", "grn", "vendor-credits", id] as const,
  receivingWorkspace: (moduleType?: PurchasingModuleType) =>
    ["purchasing", "grn", "receiving-workspace", moduleType ?? "raw_material"] as const,
  deliveries: (moduleType: PurchasingModuleType) => ["purchasing", "grn", "deliveries", moduleType] as const,
  poLines: (poId: string, moduleType: PurchasingModuleType) =>
    ["purchasing", "grn", "po-lines", poId, moduleType] as const,
  poBranch: (poId: string) => ["purchasing", "grn", "po-branch", poId] as const,
  userScope: ["purchasing", "grn", "user-scope"] as const,
  warehouses: (branchId: string | null) => ["purchasing", "warehouses", branchId] as const,
};
