import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import type { AccountTypeItem, AccountTypePayload } from "./types";

const BASE = "/api/accounting/account-types";

export const fetchAccountTypeList = () =>
  apiGet<{ data: AccountTypeItem[] }>(BASE).then((res) => res.data);

export const createAccountType = (body: AccountTypePayload) =>
  apiPost<{ data: AccountTypeItem; message?: string }>(BASE, body);

export const updateAccountType = (id: string, body: AccountTypePayload) =>
  apiPut<{ data: AccountTypeItem; message?: string }>(`${BASE}/${id}`, body);

export const deleteAccountType = (id: string) => apiDelete(`${BASE}/${id}`);
