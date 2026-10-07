"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { VendorListParams } from "./types";
import { vendorsQueryKeys } from "./query-keys";
import { getVendor, listVendors } from "./api";

export const useVendorList = (params: VendorListParams) =>
  useQuery({
    queryKey: vendorsQueryKeys.list(params),
    queryFn: () => listVendors(params),
    placeholderData: keepPreviousData,
  });

export const useVendor = (id: string) =>
  useQuery({
    queryKey: vendorsQueryKeys.detail(id),
    queryFn: () => getVendor(id),
    enabled: Boolean(id),
  });
