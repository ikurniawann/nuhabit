"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createDeal,
  createDealInvoice,
  deleteDeal,
  deleteDealInvoice,
  fetchDealInvoices,
  fetchDealPayments,
  fetchDeals,
  fetchLostReasons,
  fetchStages,
  updateDeal,
  updateStage,
  type CreateInvoiceValues,
} from "./api";
import type {
  DealFilters,
  DealFormValues,
  DealUpdatePayload,
  SalesDeal,
  SalesStage,
  StageUpdatePayload,
} from "./types";

export const pipelineQueryKeys = {
  all: ["sales-funnel", "pipeline"] as const,
  stages: (all: boolean, pipelineId?: string) => ["sales-funnel", "pipeline", "stages", all, pipelineId ?? ""] as const,
  pipelines: (all: boolean) => ["sales-funnel", "pipeline", "pipelines", all] as const,
  members: (dealId: string) => ["sales-funnel", "pipeline", "members", dealId] as const,
  lostReasons: ["sales-funnel", "pipeline", "lost-reasons"] as const,
  deals: (filters: DealFilters) =>
    ["sales-funnel", "pipeline", "deals", filters] as const,
  payments: (dealId: string) =>
    ["sales-funnel", "pipeline", "payments", dealId] as const,
  invoices: (dealId: string) =>
    ["sales-funnel", "pipeline", "invoices", dealId] as const,
};

// ── Invoice deal ─────────────────────────────────────────────────────

export const useDealInvoices = (dealId: string, enabled: boolean) =>
  useQuery({
    queryKey: pipelineQueryKeys.invoices(dealId),
    queryFn: () => fetchDealInvoices(dealId),
    enabled: enabled && dealId !== "",
  });

export const useCreateDealInvoice = (dealId: string, onSuccess?: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateInvoiceValues) => createDealInvoice(dealId, values),
    onSuccess: () => {
      toast.success("Invoice dibuat");
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.invoices(dealId),
      });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useDeleteDealInvoice = (dealId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) => deleteDealInvoice(invoiceId),
    onSuccess: () => {
      toast.success("Invoice dihapus");
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.invoices(dealId),
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

// Pencatatan/koreksi pembayaran pindah ke modul Finance (EPIC-025 Opsi B) —
// pipeline hanya MEMBACA progress pelunasan.
export const useDealPayments = (dealId: string, enabled: boolean) =>
  useQuery({
    queryKey: pipelineQueryKeys.payments(dealId),
    queryFn: () => fetchDealPayments(dealId),
    enabled: enabled && dealId !== "",
  });

export const useStages = (all = false, pipelineId?: string) =>
  useQuery({
    queryKey: pipelineQueryKeys.stages(all, pipelineId),
    queryFn: () => fetchStages(all, pipelineId),
    staleTime: 5 * 60 * 1000,
  });

export const useLostReasons = () =>
  useQuery({
    queryKey: pipelineQueryKeys.lostReasons,
    queryFn: fetchLostReasons,
    staleTime: 5 * 60 * 1000,
  });

export const useDeals = (filters: DealFilters) =>
  useQuery({
    queryKey: pipelineQueryKeys.deals(filters),
    queryFn: () => fetchDeals(filters),
  });

export function useCreateDeal(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: DealFormValues) => createDeal(values),
    onSuccess: () => {
      toast.success("Deal berhasil dibuat");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      // status lead bisa ikut berubah (baru/dihubungi → qualified)
      queryClient.invalidateQueries({ queryKey: ["sales-funnel", "leads"] });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * Update deal dengan optimistic update pada cache kanban aktif — kartu
 * langsung pindah kolom saat drag, rollback bila API menolak (pola
 * useUpdateCandidateStage pipeline HRIS).
 */
export function useUpdateDeal(filters: DealFilters, onSuccess?: () => void) {
  const queryClient = useQueryClient();
  const dealsKey = pipelineQueryKeys.deals(filters);
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: DealUpdatePayload }) =>
      updateDeal(id, values),
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey: dealsKey });
      const previous = queryClient.getQueryData<SalesDeal[]>(dealsKey);
      if (values.stage_id) {
        // Sinkronkan juga atribut tahap tujuan dari cache stages agar
        // statistik header (deal berjalan/nilai pipeline) tidak sempat basi
        const stages = queryClient.getQueryData<SalesStage[]>(
          pipelineQueryKeys.stages(false)
        );
        const target = stages?.find((s) => s.id === values.stage_id);
        const isClosing = Boolean(target?.is_won || target?.is_lost);
        queryClient.setQueryData<SalesDeal[]>(dealsKey, (old) =>
          (old ?? []).map((deal) =>
            deal.id === id
              ? {
                  ...deal,
                  stage_id: values.stage_id as string,
                  entered_stage_at: new Date().toISOString(),
                  ...(target
                    ? {
                        stage_code: target.code,
                        is_won: target.is_won,
                        is_lost: target.is_lost,
                        stuck_threshold_days: target.stuck_threshold_days,
                        closed_at: isClosing ? new Date().toISOString() : null,
                      }
                    : {}),
                }
              : deal
          )
        );
      }
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(dealsKey, context.previous);
      toast.error(error.message);
    },
    onSuccess: () => {
      onSuccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDeal(id),
    onSuccess: () => {
      toast.success("Deal dihapus");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdateStage(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: StageUpdatePayload }) =>
      updateStage(id, values),
    onSuccess: () => {
      toast.success("Tahap diperbarui");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ── EPIC-050 Fase 3: pipelines, tahap baru, deal team ──
import {
  addDealMember,
  createPipeline,
  createStage,
  fetchDealMembers,
  fetchPipelines,
  removeDealMember,
  updatePipeline,
} from "./api";
import type { DealMember } from "./types";

export const usePipelines = (all = false) =>
  useQuery({ queryKey: pipelineQueryKeys.pipelines(all), queryFn: () => fetchPipelines(all), staleTime: 5 * 60 * 1000 });

export function useCreatePipeline(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; description?: string | null; stages: Array<{ name: string; probability: number }> }) => createPipeline(values),
    onSuccess: () => {
      toast.success("Pipeline dibuat");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUpdatePipeline(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<{ name: string; description: string | null; is_default: boolean; is_active: boolean; sort_order: number }> }) => updatePipeline(id, values),
    onSuccess: () => {
      toast.success("Pipeline diperbarui");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useCreateStage(onSuccess?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { pipeline_id: string; name: string; probability: number; stuck_threshold_days?: number }) => createStage(values),
    onSuccess: () => {
      toast.success("Tahap ditambahkan");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.all });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useDealMembers = (dealId: string, enabled: boolean) =>
  useQuery({ queryKey: pipelineQueryKeys.members(dealId), queryFn: () => fetchDealMembers(dealId), enabled: enabled && dealId !== "" });

export function useAddDealMember(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { user_id: string; role: DealMember["role"]; split_percent?: number }) => addDealMember(dealId, values),
    onSuccess: () => {
      toast.success("Anggota tim ditambahkan");
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.members(dealId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRemoveDealMember(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => removeDealMember(dealId, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.members(dealId) }),
    onError: (error: Error) => toast.error(error.message),
  });
}
