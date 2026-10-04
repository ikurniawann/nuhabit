"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchApAging,
  fetchApInvoices,
  fetchApPayable,
  fetchApPayments,
  type ApListFilters,
} from "./api";
import { apKeys } from "./query-keys";

export function useApInvoiceList(filters?: ApListFilters) {
  return useQuery({
    queryKey: apKeys.invoices(filters),
    queryFn: () => fetchApInvoices(filters),
  });
}

export function useApPaymentList(filters?: ApListFilters) {
  return useQuery({
    queryKey: apKeys.payments(filters),
    queryFn: () => fetchApPayments(filters),
  });
}

export function useApPayable() {
  return useQuery({
    queryKey: apKeys.payable(),
    queryFn: fetchApPayable,
  });
}

export function useApAging(asOf?: string) {
  return useQuery({
    queryKey: apKeys.aging(asOf),
    queryFn: () => fetchApAging(asOf),
  });
}
