import type { CreateCampaignInput } from "./api";
import type { CampaignChannel, CampaignSegmentForm, CrmCampaign } from "./types";

export interface CampaignForm {
  name: string;
  message_template: string;
  last_visit_days: string;
  min_xp: string;
  tiers: string;
  /** "" = pakai segmen sederhana; selain itu id segmen tersimpan. */
  segment_id: string;
  promo_campaign_id: string;
  promo_mode: "public" | "batch";
  voucher_prefix: string;
  daily_cap: string;
  channels: CampaignChannel[];
  inapp_title: string;
  image_url: string;
  link_url: string;
  /** "" = simpan draft; selain itu nilai datetime-local "Kirim nanti". */
  send_at: string;
}

export const EMPTY_CAMPAIGN_FORM: CampaignForm = {
  name: "",
  message_template:
    "Halo {nama}! Kami kangen 🎡 Sudah lama tidak berkunjung — pakai kode {kode} untuk potongan spesial di kunjungan berikutnya.",
  last_visit_days: "60",
  min_xp: "",
  tiers: "",
  segment_id: "",
  promo_campaign_id: "",
  promo_mode: "batch",
  voucher_prefix: "WIN",
  daily_cap: "",
  channels: ["wa"],
  inapp_title: "",
  image_url: "",
  link_url: "",
  send_at: "",
};

export const CAMPAIGN_STATUS_LABELS: Record<CrmCampaign["status"], string> = {
  draft: "Draft",
  scheduled: "Terjadwal",
  sending: "Mengirim",
  paused: "Dijeda",
  done: "Selesai",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};

export const CAMPAIGN_STATUS_BADGES: Record<CrmCampaign["status"], string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-violet-100 text-violet-700",
  sending: "bg-blue-100 text-blue-700",
  paused: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-600",
  failed: "bg-red-100 text-red-700",
};

export const CHANNEL_LABELS: Record<CampaignChannel, string> = { wa: "WhatsApp", in_app: "In-app" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Nilai awal "Kirim nanti": besok pukul 10.00 waktu lokal, format datetime-local. */
export function defaultSendAt(now: number = Date.now()): string {
  const d = new Date(now + 86_400_000);
  d.setHours(10, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function segmentFromForm(form: CampaignForm): CampaignSegmentForm {
  return {
    last_visit_days: form.last_visit_days.trim() === "" ? null : Number(form.last_visit_days),
    tiers: form.tiers
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    min_xp: form.min_xp.trim() === "" ? null : Number(form.min_xp),
  };
}

export function withChannel(channels: CampaignChannel[], channel: CampaignChannel, on: boolean): CampaignChannel[] {
  return on ? [...new Set([...channels, channel])] : channels.filter((c) => c !== channel);
}

/**
 * Form tidak valid bila: tanpa kanal, waktu kirim rusak, nama/template terlalu
 * pendek, prefix voucher batch salah, atau placeholder {kode} tidak cocok
 * dengan ada/tidaknya promo.
 */
export function isCampaignFormInvalid(form: CampaignForm): boolean {
  const withPromo = form.promo_campaign_id !== "";
  const hasCode = form.message_template.includes("{kode}");
  return (
    form.channels.length === 0 ||
    (form.send_at !== "" && Number.isNaN(new Date(form.send_at).getTime())) ||
    form.name.trim().length < 2 ||
    form.message_template.trim().length < 10 ||
    (withPromo && form.promo_mode === "batch" && !/^[A-Za-z0-9]{2,12}$/.test(form.voucher_prefix.trim())) ||
    withPromo !== hasCode
  );
}

export function toCreateCampaignInput(form: CampaignForm): CreateCampaignInput {
  const withPromo = form.promo_campaign_id !== "";
  const inApp = form.channels.includes("in_app");
  const inAppField = (value: string) => (inApp ? value.trim() || null : null);
  return {
    name: form.name.trim(),
    message_template: form.message_template.trim(),
    segment: segmentFromForm(form),
    segment_id: form.segment_id || null,
    promo_campaign_id: withPromo ? form.promo_campaign_id : null,
    promo_mode: withPromo ? form.promo_mode : null,
    voucher_prefix: withPromo && form.promo_mode === "batch" ? form.voucher_prefix.trim().toUpperCase() : null,
    daily_cap: form.daily_cap.trim() === "" ? null : Number(form.daily_cap),
    channels: form.channels,
    inapp_title: inAppField(form.inapp_title),
    image_url: inAppField(form.image_url),
    link_url: inAppField(form.link_url),
    scheduled_at: form.send_at ? new Date(form.send_at).toISOString() : null,
  };
}

/** Ringkasan promo + plafon + kanal di baris tabel kampanye. */
export function campaignSummary(campaign: CrmCampaign): string {
  const promo =
    campaign.promo_mode === "batch"
      ? `voucher batch (${campaign.voucher_prefix}-…)`
      : campaign.promo_campaign_id
        ? "kode publik"
        : "tanpa promo";
  const cap = campaign.daily_cap ? ` · cap ${campaign.daily_cap}/hari` : "";
  const channels = (campaign.channels ?? ["wa"]).map((c) => CHANNEL_LABELS[c]).join(" + ");
  return `${promo}${cap} · ${channels}`;
}

/** Tombol utama per status: start/resume, atau null bila tidak ada. */
export function primaryCampaignAction(
  status: CrmCampaign["status"]
): { action: "start" | "resume"; label: string } | null {
  switch (status) {
    case "draft":
      return { action: "start", label: "Mulai" };
    case "scheduled":
      return { action: "start", label: "Kirim sekarang" };
    case "paused":
    case "failed":
      return { action: "resume", label: "Lanjutkan" };
    default:
      return null;
  }
}

export const isCancellable = (status: CrmCampaign["status"]) =>
  status === "draft" || status === "scheduled" || status === "sending" || status === "paused" || status === "failed";
