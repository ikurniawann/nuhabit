import type {
  CampaignChannel,
  CampaignConfig,
  CampaignReport,
  CampaignSegmentForm,
  CrmCampaign,
  MarketingOptout,
  SegmentPreview,
} from "./types";

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    message = body.error ?? body.message ?? fallback;
  } catch {
    // bukan JSON — pakai fallback
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
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  payload: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) await parseError(res, fallback);
  const body = (await res.json()) as { data: T };
  return body.data;
}

export const fetchCampaigns = () =>
  getJson<CrmCampaign[]>("/api/crm/campaigns", "Gagal memuat kampanye");

export interface CreateCampaignInput {
  name: string;
  message_template: string;
  segment: CampaignSegmentForm;
  /** Segmen tersimpan (EPIC-050 T-5.1); null = pakai segmen sederhana. */
  segment_id?: string | null;
  promo_campaign_id?: string | null;
  promo_mode?: "public" | "batch" | null;
  voucher_prefix?: string | null;
  daily_cap?: number | null;
  channels: CampaignChannel[];
  inapp_title?: string | null;
  image_url?: string | null;
  link_url?: string | null;
  /** Diisi = kirim nanti (ISO); null = simpan sebagai draft. */
  scheduled_at?: string | null;
}

export type CampaignActionName = "start" | "schedule" | "pause" | "resume" | "cancel";

export const createCampaign = (values: CreateCampaignInput) =>
  sendJson<{ id: string }>(
    "/api/crm/campaigns",
    "POST",
    values,
    "Gagal membuat kampanye"
  );

export const previewSegment = (segment: CampaignSegmentForm, segmentId?: string | null) =>
  sendJson<SegmentPreview>(
    "/api/crm/campaigns/preview",
    "POST",
    { segment, segment_id: segmentId ?? null },
    "Gagal menghitung segmen"
  );

export async function campaignAction(
  id: string,
  action: CampaignActionName,
  scheduledAt?: string
): Promise<{ message: string }> {
  const res = await fetch(`/api/crm/campaigns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, scheduled_at: scheduledAt }),
  });
  if (!res.ok) await parseError(res, "Gagal memperbarui kampanye");
  const body = (await res.json()) as { message?: string };
  return { message: body.message ?? "Kampanye diperbarui" };
}

export const fetchCampaignReport = (id: string) =>
  getJson<CampaignReport>(
    `/api/crm/campaigns/${id}/report`,
    "Gagal memuat laporan"
  );

export const fetchCampaignConfig = () =>
  getJson<CampaignConfig>("/api/crm/campaign-config", "Gagal memuat konfigurasi");

export const updateCampaignConfig = (values: Partial<CampaignConfig>) =>
  sendJson<CampaignConfig>(
    "/api/crm/campaign-config",
    "PUT",
    values,
    "Gagal menyimpan konfigurasi"
  );

export const fetchOptouts = () =>
  getJson<MarketingOptout[]>("/api/crm/campaign-optouts", "Gagal memuat opt-out");

export const addOptout = (phone: string, note?: string) =>
  sendJson<{ id: string }>(
    "/api/crm/campaign-optouts",
    "POST",
    { phone, note },
    "Gagal menambah opt-out"
  );

export async function removeOptout(id: string): Promise<{ id: string }> {
  const res = await fetch(`/api/crm/campaign-optouts?id=${id}`, {
    method: "DELETE",
  });
  if (!res.ok) await parseError(res, "Gagal menghapus opt-out");
  const body = (await res.json()) as { data: { id: string } };
  return body.data;
}

/** Dropdown lampiran promo — reuse API EPIC-032 (role sama). */
export const fetchPromoCampaigns = () =>
  getJson<{ id: string; name: string; is_active: boolean }[]>(
    "/api/promo/campaigns",
    "Gagal memuat campaign promo"
  );
