"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listXpRules } from "./api";
import { xpRulesQueryKeys } from "./query-keys";
import type { XpRulesListParams } from "./types";

export const useXpRulesList = (params: XpRulesListParams) =>
  useQuery({
    queryKey: xpRulesQueryKeys.list(params),
    queryFn: () => listXpRules(params),
    placeholderData: keepPreviousData,
  });
