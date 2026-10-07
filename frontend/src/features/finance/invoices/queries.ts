"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createInvoicePayment,
  deleteFakturPajak,
  deleteInvoice,
  deleteInvoicePayment,
  fetchFinanceInvoices,
  fetchInvoiceDetail,
  fetchInvoicePayments,
  reviseInvoice,
  updateInvoiceStatus,
  uploadFakturPajak,
  type CreateInvoicePaymentValues,
  type FinanceInvoiceFilters,
  type ReviseInvoiceValues,
} from "./api";

export const financeQueryKeys = {
  all: ["finance", "invoices"] as const,
  invoices: (filters: FinanceInvoiceFilters) =>
    ["finance", "invoices", "list", filters] as const,
  detail: (invoiceId: string) =>
    ["finance", "invoices", "detail", invoiceId] as const,
  payments: (invoiceId: string) =>
    ["finance", "invoices", "payments", invoiceId] as const,
};

export const useInvoiceDetail = (invoiceId: string, enabled: boolean) =>
  useQuery({
    queryKey: financeQueryKeys.detail(invoiceId),
    queryFn: () => fetchInvoiceDetail(invoiceId),
    enabled: enabled && invoiceId !== "",
  });

export const useReviseInvoice = (onSuccess?: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      values,
    }: {
      invoiceId: string;
      values: ReviseInvoiceValues;
    }) => reviseInvoice(invoiceId, values),
    onSuccess: () => {
      toast.success("Invoice direvisi");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useFinanceInvoices = (filters: FinanceInvoiceFilters) =>
  useQuery({
    queryKey: financeQueryKeys.invoices(filters),
    queryFn: () => fetchFinanceInvoices(filters),
  });

export const useUpdateInvoiceStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      status,
    }: {
      invoiceId: string;
      status: "terkirim" | "batal";
    }) => updateInvoiceStatus(invoiceId, status),
    onSuccess: () => {
      toast.success("Invoice diperbarui");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useDeleteInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => deleteInvoice(invoiceId),
    onSuccess: () => {
      toast.success("Invoice dihapus");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useUploadFakturPajak = (onSuccess?: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, file }: { invoiceId: string; file: File }) =>
      uploadFakturPajak(invoiceId, file),
    onSuccess: () => {
      toast.success("Faktur pajak tersimpan");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useDeleteFakturPajak = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => deleteFakturPajak(invoiceId),
    onSuccess: () => {
      toast.success("Lampiran faktur pajak dihapus");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useInvoicePayments = (invoiceId: string, enabled: boolean) =>
  useQuery({
    queryKey: financeQueryKeys.payments(invoiceId),
    queryFn: () => fetchInvoicePayments(invoiceId),
    enabled: enabled && invoiceId !== "",
  });

export const useCreateInvoicePayment = (
  invoiceId: string,
  onSuccess?: () => void
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateInvoicePaymentValues) =>
      createInvoicePayment(invoiceId, values),
    onSuccess: () => {
      toast.success("Pembayaran tercatat");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useDeleteInvoicePayment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => deleteInvoicePayment(paymentId),
    onSuccess: () => {
      toast.success("Catatan pembayaran dihapus");
      queryClient.invalidateQueries({ queryKey: financeQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};
