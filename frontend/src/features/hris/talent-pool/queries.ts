"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchActiveBrands } from "../candidates/api";
import { talentPoolQueryKeys } from "./query-keys";
import { fetchTalentPool } from "./api";

export const useTalentPool = (brandId?: string) =>
  useQuery({
    queryKey: talentPoolQueryKeys.list(brandId),
    queryFn: () => fetchTalentPool(brandId),
  });

export const useActiveBrands = () =>
  useQuery({
    queryKey: talentPoolQueryKeys.brands(),
    queryFn: fetchActiveBrands,
  });
