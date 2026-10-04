"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createQuotation,
  deleteQuotation,
  fetchCatalogProducts,
  fetchQuotations,
  realizeQuotation,
  sendQuotationWa,
  updateQuotation,
  reviseQuotation,
} from "./api";
import type { QuotationFormValues, QuotationStatus } from "./types";
import { RealizeConflictError } from "./types";

export const quotationQueryKeys = {
  all: ["sales-funnel", "quotations"] as const,
  byDeal: (dealId: string) => ["sales-funnel", "quotations", dealId] as const,
  products: ["sales-funnel", "catalog-products"] as const,
};

export const useQuotations = (dealId: string, enabled = true) =>
  useQuery({
    queryKey: quotationQueryKeys.byDeal(dealId),
    queryFn: () => fetchQuotations(dealId),
    enabled: enabled && dealId !== "",
  });

export const useCatalogProducts = (enabled = true) =>
  useQuery({
    queryKey: quotationQueryKeys.products,
    queryFn: fetchCatalogProducts,
    staleTime: 5 * 60 * 1000,
    enabled,
  });

function invalidateQuotationCaches(
  queryClient: ReturnType<typeof useQueryClient>
) {
  queryClient.invalidateQueries({ queryKey: quotationQueryKeys.all });
  // value_estimate deal ikut berubah — kanban & 360° wajib segar
  queryClient.invalidateQueries({ queryKey: ["sales-funnel", "pipeline"] });
  queryClient.invalidateQueries({ queryKey: ["sales-funnel", "leads"] });
}

export function useCreateQuotation(dealId: string, onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: QuotationFormValues) => createQuotation(dealId, form),
    onSuccess: (body: { message?: string }) => {
      toast.success(body.message ?? "Quotation dibuat");
      invalidateQuotationCaches(queryClient);
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateQuotation(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: { form?: QuotationFormValues; status?: QuotationStatus };
    }) => updateQuotation(id, values),
    onSuccess: () => {
      toast.success("Quotation diperbarui");
      invalidateQuotationCaches(queryClient);
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQuotation(id),
    onSuccess: () => {
      toast.success("Quotation dihapus");
      invalidateQuotationCaches(queryClient);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRealizeQuotation(
  onConflict: (error: RealizeConflictError, quotationId: string) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      realizeQuotation(id, force),
    onSuccess: (body: { message?: string; data?: { warnings?: string[] } }) => {
      toast.success(body.message ?? "Realisasi selesai");
      for (const warning of body.data?.warnings ?? []) {
        toast.warning(warning);
      }
      invalidateQuotationCaches(queryClient);
    },
    // id diambil dari variables mutation — bukan state komponen terpisah
    // yang rawan closure basi (temuan LOW gate F3)
    onError: (error: Error, variables) => {
      if (error instanceof RealizeConflictError) {
        onConflict(error, variables.id);
        return;
      }
      toast.error(error.message);
    },
  });
}

export function useSendQuotationWa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendQuotationWa(id),
    onSuccess: (body: { message?: string }) => {
      toast.success(body.message ?? "Quotation terkirim");
      invalidateQuotationCaches(queryClient);
      // kirim WA tercatat sebagai aktivitas di timeline deal
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "activities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useReviseQuotation(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reviseQuotation(id),
    onSuccess: (body) => {
      toast.success(body.message ?? "Revisi dibuat");
      queryClient.invalidateQueries({ queryKey: quotationQueryKeys.byDeal(dealId) });
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "pipeline"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
