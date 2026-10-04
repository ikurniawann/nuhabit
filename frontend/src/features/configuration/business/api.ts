import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import type { PosReceiptSettings } from "@/lib/pos/receipt-settings";
import type {
  BusinessTree,
  CreateBusinessPayload,
  UpdateBusinessPayload,
  BusinessEntityType,
} from "./types";

const BASE = "/api/settings/business";

export async function fetchBusinessTree(): Promise<BusinessTree> {
  const res = await apiGet<{ data: BusinessTree }>(BASE);
  return res.data;
}

export async function createBusinessEntity(payload: CreateBusinessPayload) {
  return apiPost<{
    data: { id: string; type: BusinessEntityType };
    tree: BusinessTree;
  }>(BASE, payload);
}

export async function updateBusinessEntity(
  type: BusinessEntityType,
  id: string,
  payload: UpdateBusinessPayload,
) {
  const response = await fetch(`${BASE}/${type}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Gagal memperbarui data");
  }
  return json as { data: { id: string }; tree: BusinessTree };
}

export async function deleteBusinessEntity(
  type: BusinessEntityType,
  id: string,
) {
  const response = await fetch(`${BASE}/${type}/${id}`, { method: "DELETE" });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Gagal menghapus data");
  }
  return json as { data: { id: string }; tree: BusinessTree };
}

export type ReceiptStallOption = {
  id: string;
  name: string;
  branch_id: string | null;
};
export type ReceiptSettingsData = {
  data: PosReceiptSettings[];
  stalls: ReceiptStallOption[];
};

export const fetchReceiptSettings = () =>
  apiGet<ReceiptSettingsData>("/api/settings/receipt");

export const saveReceiptSettings = (body: {
  warehouse_id: string | null;
  branch_id: string | null;
  header_lines: string[];
  footer_lines: string[];
  show_stall_name: boolean;
}) => apiPut<{ data: PosReceiptSettings[] }>("/api/settings/receipt", body);

export interface CompanyProfile {
  legal_name: string | null;
  address: string | null;
  city: string | null;
  signer_name: string | null;
  signer_title: string | null;
}

export const fetchCompanyProfile = () =>
  apiGet<{ data: CompanyProfile }>("/api/settings/company-profile").then(
    (r) => r.data,
  );

export const saveCompanyProfile = (
  body: Partial<Record<keyof CompanyProfile, string>>,
) => apiPut("/api/settings/company-profile", body);
