"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchArAging,
  fetchArInvoiceBySalesInvoice,
  fetchArInvoices,
  fetchArReceivable,
  fetchArReceipts,
  type ArListFilters,
} from "./api";
import { arKeys } from "./query-keys";

export function useArInvoiceList(filters?: ArListFilters) {
  return useQuery({
    queryKey: arKeys.invoices(filters),
    queryFn: () => fetchArInvoices(filters),
  });
}

export function useArReceiptList(filters?: ArListFilters) {
  return useQuery({
    queryKey: arKeys.receipts(filters),
    queryFn: () => fetchArReceipts(filters),
  });
}

export function useArReceivable() {
  return useQuery({
    queryKey: arKeys.receivable(),
    queryFn: fetchArReceivable,
  });
}

export function useArAging(asOf?: string) {
  return useQuery({
    queryKey: arKeys.aging(asOf),
    queryFn: () => fetchArAging(asOf),
  });
}

/** Deep link ?sales_invoice=: AR invoice terkait; galat (mis. 404) diabaikan. */
export function useArInvoiceBySalesInvoice(salesInvoiceId: string | null) {
  return useQuery({
    queryKey: arKeys.bySalesInvoice(salesInvoiceId ?? ""),
    queryFn: () => fetchArInvoiceBySalesInvoice(salesInvoiceId!),
    enabled: Boolean(salesInvoiceId),
    retry: false,
  });
}
