"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchTabStats,
  fetchVisitDetail,
  fetchVisits,
  markBandLost,
  registerVisit,
  settleVisit,
  topupVisit,
  voidCharge,
} from "./api";
import type { RegisterVisitValues, SettleValues, VisitFilters } from "./types";

export const visitQueryKeys = {
  all: ["ticketing", "visits"] as const,
  list: (filters: VisitFilters) => ["ticketing", "visits", filters] as const,
  detail: (id: string) => ["ticketing", "visits", "detail", id] as const,
};

export const useVisits = (filters: VisitFilters) =>
  useQuery({
    queryKey: visitQueryKeys.list(filters),
    queryFn: () => fetchVisits(filters),
    refetchInterval: 30_000, // tab monitor ringan — daftar visit open bergerak
  });

export const useVisitDetail = (id: string | null) =>
  useQuery({
    queryKey: visitQueryKeys.detail(id ?? ""),
    queryFn: () => fetchVisitDetail(id!),
    enabled: id !== null,
  });

function useVisitMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
  successMessage: string,
  onSuccess?: () => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      toast.success(successMessage);
      queryClient.invalidateQueries({ queryKey: visitQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "bands"] });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "tab-stats"] });
      onSuccess?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export const useRegisterVisit = (onSuccess?: (id: string) => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: RegisterVisitValues) => registerVisit(values),
    onSuccess: (data) => {
      toast.success("Kunjungan terdaftar — gelang siap dipakai");
      queryClient.invalidateQueries({ queryKey: visitQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["ticketing", "bands"] });
      onSuccess?.(data.id);
    },
    onError: (error: Error) => toast.error(error.message),
  });
};

export const useTopupVisit = (onSuccess?: () => void) =>
  useVisitMutation(
    ({ id, values }: { id: string; values: { amount: number; method: string } }) =>
      topupVisit(id, values),
    "Top-up tersimpan",
    onSuccess
  );

export const useSettleVisit = (onSuccess?: () => void) =>
  useVisitMutation(
    ({ id, values }: { id: string; values: SettleValues }) =>
      settleVisit(id, values),
    "Settlement berhasil",
    onSuccess
  );

export const useTabStats = () =>
  useQuery({
    queryKey: ["ticketing", "tab-stats"] as const,
    queryFn: fetchTabStats,
    refetchInterval: 30_000, // tab monitor live
  });

export const useMarkBandLost = (onSuccess?: () => void) =>
  useVisitMutation(
    ({ visitId, visitBandId }: { visitId: string; visitBandId: string }) =>
      markBandLost(visitId, visitBandId),
    "Gelang ditandai hilang — tagihan tetap tertagih saat settlement",
    onSuccess
  );

export const useVoidCharge = (onSuccess?: () => void) =>
  useVisitMutation(
    ({
      visitId,
      chargeId,
      reason,
    }: {
      visitId: string;
      chargeId: string;
      reason: string;
    }) => voidCharge(visitId, chargeId, reason),
    "Tagihan di-void",
    onSuccess
  );
