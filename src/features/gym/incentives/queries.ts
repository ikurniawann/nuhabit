/** React Query untuk Gym → Insentif Coach. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { incentivesApi } from "./api";

export const incentiveKeys = {
  all: ["gym", "incentives"] as const,
  statements: (month: string) => ["gym", "incentives", "statements", month] as const,
  payouts: (month: string) => ["gym", "incentives", "payouts", month] as const,
  payout: (id: string) => ["gym", "incentives", "payout", id] as const,
  schemes: ["gym", "incentives", "schemes"] as const,
};

export const useStatements = (month: string) =>
  useQuery({ queryKey: incentiveKeys.statements(month), queryFn: () => incentivesApi.statements(month) });

export const usePayouts = (month: string) =>
  useQuery({ queryKey: incentiveKeys.payouts(month), queryFn: () => incentivesApi.payouts(month) });

export const usePayoutDetail = (id: string) =>
  useQuery({ queryKey: incentiveKeys.payout(id), queryFn: () => incentivesApi.payout(id) });

export const useSchemes = () => useQuery({ queryKey: incentiveKeys.schemes, queryFn: incentivesApi.schemes });

/** Muat ulang statement dan payout satu bulan setelah payout berubah. */
export function useRefreshMonth(month: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: incentiveKeys.statements(month) });
    void queryClient.invalidateQueries({ queryKey: incentiveKeys.payouts(month) });
  };
}

/** Skema memengaruhi semua statement, jadi seluruh cache insentif dimuat ulang. */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: incentiveKeys.all });
}
