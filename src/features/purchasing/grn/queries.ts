"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { GrnListParams } from "./types";
import {
  getGrn,
  getGrnPoBranchId,
  getGrnPoLines,
  getGrnQC,
  getGrnVendorCredits,
  getReceivingUserScope,
  getReceivingWorkspace,
  listGrnDeliveries,
  listGrns,
  listWarehouses,
  type PurchasingModuleType,
} from "./api";
import { grnQueryKeys } from "./query-keys";

export const useGrnList = (params: GrnListParams) =>
  useQuery({
    queryKey: grnQueryKeys.list(params),
    queryFn: () => listGrns(params),
    placeholderData: keepPreviousData,
  });

export const useGrn = <T>(id: string) =>
  useQuery({
    queryKey: grnQueryKeys.detail(id),
    queryFn: () => getGrn<T>(id),
    enabled: !!id,
  });

export const useGrnQC = <T>(id: string) =>
  useQuery({
    queryKey: grnQueryKeys.qc(id),
    queryFn: () => getGrnQC<T>(id),
    enabled: !!id,
  });

export const useGrnVendorCredits = (id: string) =>
  useQuery({
    queryKey: grnQueryKeys.vendorCredits(id),
    queryFn: () => getGrnVendorCredits(id),
    enabled: !!id,
  });

export const useReceivingWorkspace = (moduleType?: PurchasingModuleType) =>
  useQuery({
    queryKey: grnQueryKeys.receivingWorkspace(moduleType),
    queryFn: () => getReceivingWorkspace(moduleType),
  });

/** Pengiriman yang belum punya GRN (opsi form Buat GRN). */
export const useGrnDeliveries = (moduleType: PurchasingModuleType) =>
  useQuery({
    queryKey: grnQueryKeys.deliveries(moduleType),
    queryFn: () => listGrnDeliveries(moduleType),
  });

export const useGrnPoLines = (poId: string | null | undefined, moduleType: PurchasingModuleType) =>
  useQuery({
    queryKey: grnQueryKeys.poLines(poId ?? "", moduleType),
    queryFn: () => getGrnPoLines(poId ?? "", moduleType),
    enabled: !!poId,
  });

export const useGrnPoBranch = (poId: string | null) =>
  useQuery({
    queryKey: grnQueryKeys.poBranch(poId ?? ""),
    queryFn: () => getGrnPoBranchId(poId ?? ""),
    enabled: !!poId,
    retry: false,
  });

export const useReceivingUserScope = () =>
  useQuery({
    queryKey: grnQueryKeys.userScope,
    queryFn: getReceivingUserScope,
  });

/** Gudang; `branchId` undefined = cabang belum diketahui (query ditahan). */
export const useWarehouses = (branchId: string | null | undefined) =>
  useQuery({
    queryKey: grnQueryKeys.warehouses(branchId ?? null),
    queryFn: () => listWarehouses(branchId),
    enabled: branchId !== undefined,
  });
