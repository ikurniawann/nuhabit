import {
  buildListUrl,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
} from "@/lib/api-client";
import type { ListParams, ListResponse } from "@/types/api";
import type {
  RoleItem,
  RoleDetail,
  CreateRolePayload,
  UpdateRolePayload,
  RoleMenuPermission,
  RolePermissionUpdate,
} from "./types";

const BASE = "/api/settings/iam/roles";

export const fetchRoleList = (params?: ListParams) =>
  apiGet<ListResponse<RoleItem>>(buildListUrl(BASE, { ...params }));

export const fetchRoleDetail = (id: string) =>
  apiGet<RoleDetail>(`${BASE}/${id}`);

export const createRole = (body: CreateRolePayload) =>
  apiPost<{ id: string }>(BASE, body);

export const updateRole = (id: string, body: UpdateRolePayload) =>
  apiPut<{ id: string }>(`${BASE}/${id}`, body);

export const deleteRole = (id: string) => apiDelete(`${BASE}/${id}`);

export const fetchRolePermissions = (id: string) =>
  apiGet<{ roleId: string; permissions: RoleMenuPermission[] }>(
    `${BASE}/${id}/permissions`,
  );

export const updateRolePermissions = (
  id: string,
  permissions: RolePermissionUpdate[],
) =>
  apiPut<{ roleId: string; permissions: RoleMenuPermission[] }>(
    `${BASE}/${id}/permissions`,
    { permissions },
  );
