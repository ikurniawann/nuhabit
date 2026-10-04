import type {
  PromoCampaign,
  PromoCampaignFormValues,
  PromoCode,
  PromoRedemption,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // body bukan JSON — pakai fallback
  }
  throw new Error(message);
}

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers:
      method === "DELETE"
        ? undefined
        : { "Content-Type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const fetchCampaigns = () =>
  getJson<PromoCampaign[]>("/api/promo/campaigns", "Gagal memuat campaign");

export const createCampaign = (values: PromoCampaignFormValues) =>
  sendJson<{ id: string }>(
    "/api/promo/campaigns",
    "POST",
    values,
    "Gagal membuat campaign"
  );

export const updateCampaign = (
  id: string,
  values: Partial<PromoCampaignFormValues> & { is_active?: boolean; show_in_member_portal?: boolean }
) =>
  sendJson<{ id: string }>(
    `/api/promo/campaigns/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui campaign"
  );

export const fetchCodes = (campaignId: string) =>
  getJson<PromoCode[]>(
    `/api/promo/campaigns/${campaignId}/codes`,
    "Gagal memuat kode"
  );

export const createSingleCode = (
  campaignId: string,
  code: string,
  usageLimit: number | null
) =>
  sendJson<PromoCode>(
    `/api/promo/campaigns/${campaignId}/codes`,
    "POST",
    { mode: "single", code, usage_limit: usageLimit },
    "Gagal menambah kode"
  );

export const generateBatchCodes = (
  campaignId: string,
  prefix: string,
  count: number
) =>
  sendJson<{ count: number; codes: string[] }>(
    `/api/promo/campaigns/${campaignId}/codes`,
    "POST",
    { mode: "batch", prefix, count },
    "Gagal generate voucher"
  );

export const syncVoucherCount = (
  campaignId: string,
  targetCount: number,
  prefix?: string
) =>
  sendJson<{ count: number; added: number; removed: number }>(
    `/api/promo/campaigns/${campaignId}/codes`,
    "PATCH",
    {
      target_count: targetCount,
      ...(prefix ? { prefix } : {}),
    },
    "Gagal mengubah jumlah voucher"
  );

export const toggleCode = (id: string, isActive: boolean) =>
  sendJson<{ id: string }>(
    `/api/promo/codes/${id}`,
    "PATCH",
    { is_active: isActive },
    "Gagal memperbarui kode"
  );

export const updateCode = (
  id: string,
  values: { code?: string; usage_limit?: number | null; is_active?: boolean }
) =>
  sendJson<{ id: string }>(
    `/api/promo/codes/${id}`,
    "PATCH",
    values,
    "Gagal memperbarui kode"
  );

export const deleteCode = (id: string) =>
  sendJson<{ id: string }>(
    `/api/promo/codes/${id}`,
    "DELETE",
    null,
    "Gagal menghapus kode"
  );

export const fetchRedemptions = (campaignId: string) =>
  getJson<PromoRedemption[]>(
    `/api/promo/campaigns/${campaignId}/redemptions`,
    "Gagal memuat riwayat"
  );
