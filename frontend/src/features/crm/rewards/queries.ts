"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listRedemptions, listRewards, searchClaimMembers } from "./api";
import { redemptionsQueryKeys, rewardsQueryKeys } from "./query-keys";
import type { RedemptionsListParams, RewardsListParams } from "./types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export const useRewardsList = (params: RewardsListParams) =>
  useQuery({
    queryKey: rewardsQueryKeys.list(params),
    queryFn: () => listRewards(params),
    placeholderData: keepPreviousData,
  });

export const useRedemptionsList = (params: RedemptionsListParams) =>
  useQuery({
    queryKey: redemptionsQueryKeys.list(params),
    queryFn: () => listRedemptions(params),
    placeholderData: keepPreviousData,
  });

/** Pencarian member untuk panel klaim kasir. `term` kosong = query nonaktif. */
export const useClaimMembers = (term: string) => {
  const debounced = useDebouncedValue(term, 300);

  return useQuery({
    queryKey: ["crm", "rewards", "claim-members", debounced] as const,
    queryFn: () => searchClaimMembers(debounced),
    enabled: debounced.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
};
