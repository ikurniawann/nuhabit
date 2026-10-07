"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { listPurchaseInvoices } from "./api";
import { vendorPaymentsQueryKeys } from "./query-keys";
import type { PurchaseInvoiceListParams } from "./types";

export const usePurchaseInvoiceList = (
  params: PurchaseInvoiceListParams,
  moduleType: PurchasingModuleType = "raw_material"
) =>
  useQuery({
    queryKey: vendorPaymentsQueryKeys.list(params, moduleType),
    queryFn: () => listPurchaseInvoices(params, moduleType),
    placeholderData: keepPreviousData,
  });

/** @deprecated Use usePurchaseInvoiceList */
export const useVendorPaymentList = usePurchaseInvoiceList;
