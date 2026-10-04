"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchBusinessTree,
  fetchCompanyProfile,
  fetchReceiptSettings,
} from "./api";
import { businessQueryKeys } from "./query-keys";

export const useBusinessTree = (enabled = true) =>
  useQuery({
    queryKey: businessQueryKeys.tree(),
    queryFn: fetchBusinessTree,
    enabled,
    retry: 1,
    staleTime: 60_000,
  });

export const useReceiptSettings = () =>
  useQuery({
    queryKey: businessQueryKeys.receipt(),
    queryFn: fetchReceiptSettings,
  });

export const useCompanyProfile = () =>
  useQuery({
    queryKey: businessQueryKeys.companyProfile(),
    queryFn: fetchCompanyProfile,
  });
