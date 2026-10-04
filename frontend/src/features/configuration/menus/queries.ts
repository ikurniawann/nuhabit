"use client";

import { useQuery } from "@tanstack/react-query";
import { menusQueryKeys } from "./query-keys";
import type { ListParams } from "@/types/api";
import { fetchMenuList, fetchMenuDetail } from "./api";

export const useMenuList = (params?: ListParams) =>
  useQuery({
    queryKey: menusQueryKeys.list(params),
    queryFn: () => fetchMenuList(params),
  });

export const useMenuDetail = (id: string | null) =>
  useQuery({
    queryKey: menusQueryKeys.detail(id ?? ""),
    queryFn: () => fetchMenuDetail(id!),
    enabled: id !== null,
  });
