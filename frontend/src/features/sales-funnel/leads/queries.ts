"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createLead,
  deleteLead,
  fetchLeadDetail,
  fetchLeads,
  linkLeadCustomer,
  lookupPicByPhone,
  searchCustomers,
  unlinkLeadCustomer,
  updateLead,
} from "./api";
import type { LeadFilters, LeadFormValues } from "./types";

export const leadQueryKeys = {
  all: ["sales-funnel", "leads"] as const,
  list: (filters: LeadFilters) => ["sales-funnel", "leads", filters] as const,
  detail: (id: string) => ["sales-funnel", "leads", "detail", id] as const,
  customerSearch: (q: string) =>
    ["sales-funnel", "customer-search", q] as const,
};

export const useLeads = (filters: LeadFilters) =>
  useQuery({
    queryKey: leadQueryKeys.list(filters),
    queryFn: () => fetchLeads(filters),
  });

export function useCreateLead(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: LeadFormValues) => createLead(values),
    onSuccess: () => {
      toast.success("Lead berhasil dibuat");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateLead(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<LeadFormValues> }) =>
      updateLead(id, values),
    onSuccess: () => {
      toast.success("Lead diperbarui");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: () => {
      toast.success("Lead dihapus");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ── Detail 360° & tautan member (Fase D) ──

export const useLeadDetail = (id: string) =>
  useQuery({
    queryKey: leadQueryKeys.detail(id),
    queryFn: () => fetchLeadDetail(id),
    enabled: id !== "",
  });

export const usePicLookup = (phone: string, enabled = true) =>
  useQuery({
    queryKey: ["sales-funnel", "pic-lookup", phone] as const,
    queryFn: () => lookupPicByPhone(phone),
    enabled: enabled && phone.replace(/[^0-9]/g, "").length >= 9,
    staleTime: 30 * 1000,
  });

export const useCustomerSearch = (q: string) =>
  useQuery({
    queryKey: leadQueryKeys.customerSearch(q),
    queryFn: () => searchCustomers(q),
    enabled: q.trim().length >= 3,
  });

export function useLinkLeadCustomer(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      payload,
    }: {
      leadId: string;
      payload: { customer_id?: string; create_from_pic?: boolean };
    }) => linkLeadCustomer(leadId, payload),
    onSuccess: () => {
      toast.success("PIC tertaut ke member loyalty");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      // customer_id ikut di-join ke kartu kanban (checkbox "jadikan member"
      // di dialog Menang membacanya) — cache pipeline wajib ikut segar
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "pipeline"] });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUnlinkLeadCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => unlinkLeadCustomer(leadId),
    onSuccess: () => {
      toast.success("Tautan member dilepas");
      queryClient.invalidateQueries({ queryKey: leadQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "pipeline"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
