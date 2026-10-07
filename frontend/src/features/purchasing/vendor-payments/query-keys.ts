import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import type { PurchaseInvoiceListParams } from "./types";

export const vendorPaymentsQueryKeys = {
  all: ["purchasing", "purchase-invoices"] as const,
  list: (params: PurchaseInvoiceListParams, moduleType: PurchasingModuleType = "raw_material") =>
    ["purchasing", "purchase-invoices", "list", moduleType, params] as const,
};
