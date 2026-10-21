import type { PurchasingModuleType } from "@/features/purchasing/module-type";
import type { PurchaseInvoiceListParams } from "./types";

export const vendorPaymentsQueryKeys = {
  all: ["purchasing", "purchase-invoices"] as const,
  list: (params: PurchaseInvoiceListParams, moduleType: PurchasingModuleType = "raw_material") =>
    ["purchasing", "purchase-invoices", "list", moduleType, params] as const,
};
