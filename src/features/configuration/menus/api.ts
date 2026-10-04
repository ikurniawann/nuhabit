import {
  buildListUrl,
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
} from "@/lib/api-client";
import type { ListParams, ListResponse } from "@/types/api";
import type {
  MenuItem,
  MenuDetail,
  CreateMenuPayload,
  UpdateMenuPayload,
} from "@/lib/iam/menu-types";

const BASE = "/api/settings/iam/menus";

export const fetchMenuList = (params?: ListParams) =>
  apiGet<ListResponse<MenuItem>>(buildListUrl(BASE, { ...params }));

export const fetchMenuDetail = (id: string) =>
  apiGet<MenuDetail>(`${BASE}/${id}`);

export const createMenu = (body: CreateMenuPayload) =>
  apiPost<{ id: string }>(BASE, body);

export const updateMenu = (id: string, body: UpdateMenuPayload) =>
  apiPut<{ id: string }>(`${BASE}/${id}`, body);

export const deleteMenu = (id: string) => apiDelete(`${BASE}/${id}`);
