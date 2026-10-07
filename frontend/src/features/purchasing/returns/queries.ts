"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import type { ReturnListParams } from "@/types/purchasing";
import { listReturnsPaged, getReturn, getReturnFormData, listReturnGrnOptions } from "./api";
import { returnsQueryKeys } from "./query-keys";

export const useReturnList = (
  params: ReturnListParams,
  moduleType: PurchasingModuleType = "raw_material"
) =>
  useQuery({
    queryKey: returnsQueryKeys.list({ ...params, module_type: moduleType }),
    queryFn: () => listReturnsPaged({ ...params, module_type: moduleType }),
    placeholderData: keepPreviousData,
  });

export const useReturn = (id: string) =>
  useQuery({
    queryKey: returnsQueryKeys.detail(id),
    queryFn: () => getReturn(id),
    enabled: !!id,
  });

export const useReturnFormData = (
  grnId?: string | null,
  excludeReturnId?: string | null
) =>
  useQuery({
    queryKey: returnsQueryKeys.formData(grnId, excludeReturnId),
    queryFn: () => getReturnFormData(grnId, excludeReturnId),
    enabled: Boolean(grnId),
  });

export const useReturnGrnOptions = (moduleType: "raw_material" | "product" | "general" = "raw_material") =>
  useQuery({
    queryKey: returnsQueryKeys.grnOptions(moduleType),
    queryFn: () => listReturnGrnOptions(moduleType),
  });
