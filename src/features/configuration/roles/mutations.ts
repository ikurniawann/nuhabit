"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rolesQueryKeys } from "./query-keys";
import {
  createRole,
  updateRole,
  deleteRole,
  updateRolePermissions,
} from "./api";
import type {
  CreateRolePayload,
  UpdateRolePayload,
  RolePermissionUpdate,
} from "./types";

function useInvalidateRoles() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: rolesQueryKeys.all });
}

export function useCreateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (payload: CreateRolePayload) => createRole(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateRolePayload & { id: string }) =>
      updateRole(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteRole() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: invalidate,
  });
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      permissions,
    }: {
      id: string;
      permissions: RolePermissionUpdate[];
    }) => updateRolePermissions(id, permissions),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: rolesQueryKeys.all });
      qc.invalidateQueries({ queryKey: rolesQueryKeys.detail(variables.id) });
      qc.invalidateQueries({
        queryKey: rolesQueryKeys.permissions(variables.id),
      });
    },
  });
}
