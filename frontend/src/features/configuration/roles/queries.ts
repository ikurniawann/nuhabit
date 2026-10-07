"use client";

import { useQuery } from "@tanstack/react-query";
import { rolesQueryKeys } from "./query-keys";
import type { ListParams } from "@/types/api";
import { fetchRoleList, fetchRoleDetail, fetchRolePermissions } from "./api";

export const useRoleList = (params?: ListParams) =>
  useQuery({
    queryKey: rolesQueryKeys.list(params),
    queryFn: () => fetchRoleList(params),
  });

export const useRoleDetail = (id: string | null) =>
  useQuery({
    queryKey: rolesQueryKeys.detail(id ?? ""),
    queryFn: () => fetchRoleDetail(id!),
    enabled: id !== null,
  });

export const useRolePermissions = (id: string | null) =>
  useQuery({
    queryKey: rolesQueryKeys.permissions(id ?? ""),
    queryFn: () => fetchRolePermissions(id!),
    enabled: id !== null,
  });
