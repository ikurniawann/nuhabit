"use client";

import { useQuery } from "@tanstack/react-query";
import type { PurchasingModuleType } from "@/features/purchasing/module-type";
import { listPendingPRApprovals } from "./api";
import { approvalQueryKeys } from "./query-keys";

export const usePendingPRApprovals = (moduleType: PurchasingModuleType = "raw_material") =>
  useQuery({
    queryKey: approvalQueryKeys.pendingPRs(moduleType),
    queryFn: () => listPendingPRApprovals(moduleType),
  });
