/**
 * Form campaign promo (buat/ubah): state awal, validasi, payload API, dan
 * teks tabel. Murni supaya bisa diuji tanpa React.
 */
import { formatRupiah } from "@/lib/format";
import {
  PROMO_SCOPE_PREFIX,
  type PromoCampaign,
  type PromoCampaignFormValues,
  type PromoDiscountType,
  type PromoEligibility,
  type PromoScope,
} from "./types";

export type CodeMode = "none" | "public" | "batch";

export interface CampaignForm {
  name: string;
  discount_type: PromoDiscountType;
  value: string;
  max_discount: string;
  min_purchase: string;
  valid_from: string;
  valid_until: string;
  usage_limit: string;
  per_phone_limit: string;
  scope: PromoScope;
  code_mode: CodeMode;
  public_code: string;
  batch_prefix: string;
  batch_count: string;
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: PromoEligibility;
  new_member_days: string;
}

export const EMPTY_CAMPAIGN_FORM: CampaignForm = {
  name: "",
  discount_type: "percent",
  value: "",
  max_discount: "",
  min_purchase: "",
  valid_from: "",
  valid_until: "",
  usage_limit: "",
  per_phone_limit: "1",
  scope: "pos",
  code_mode: "batch",
  public_code: "",
  batch_prefix: "",
  batch_count: "10",
  target_product_ids: [],
  target_category_ids: [],
  eligibility: "semua",
  new_member_days: "",
};

/** Form edit dari campaign tersimpan; jumlah voucher = jumlah kode saat ini. */
export function campaignFormFromCampaign(campaign: PromoCampaign): CampaignForm {
  return {
    name: campaign.name,
    discount_type: campaign.discount_type,
    value: String(Number(campaign.value)),
    max_discount: campaign.max_discount ? String(Number(campaign.max_discount)) : "",
    min_purchase: Number(campaign.min_purchase) > 0 ? String(Number(campaign.min_purchase)) : "",
    valid_from: campaign.valid_from ?? "",
    valid_until: campaign.valid_until ?? "",
    usage_limit: campaign.usage_limit !== null ? String(campaign.usage_limit) : "",
    per_phone_limit: campaign.per_phone_limit !== null ? String(campaign.per_phone_limit) : "",
    scope: campaign.scope,
    code_mode: "none",
    public_code: "",
    batch_prefix: "",
    batch_count: String(Number(campaign.codes_count) || 0),
    target_product_ids: campaign.target_product_ids ?? [],
    target_category_ids: campaign.target_category_ids ?? [],
    eligibility: campaign.eligibility ?? "semua",
    new_member_days: campaign.new_member_days !== null ? String(campaign.new_member_days) : "",
  };
}

/** Kosong = tanpa batas hari; selain itu bilangan bulat 1–3650. */
export function isValidNewMemberDays(value: Pick<CampaignForm, "eligibility" | "new_member_days">): boolean {
  if (value.eligibility !== "member_baru" || value.new_member_days.trim() === "") return true;
  const days = Number(value.new_member_days);
  return Number.isInteger(days) && days >= 1 && days <= 3650;
}

/** Prefix voucher: isian admin, atau bawaan kanal. */
export const resolveVoucherPrefix = (form: Pick<CampaignForm, "batch_prefix" | "scope">) =>
  form.batch_prefix.trim().toUpperCase() || PROMO_SCOPE_PREFIX[form.scope];

/** True bila form belum boleh disimpan (aturan sama dengan validasi server). */
export function isCampaignFormInvalid(form: CampaignForm, isEdit: boolean): boolean {
  const value = Number(form.value);
  const batchCount = Number(form.batch_count);
  const batchInvalid = isEdit
    ? form.batch_count.trim() === "" || Number.isNaN(batchCount) || batchCount < 0 || batchCount > 1000
    : form.code_mode === "batch" && (Number.isNaN(batchCount) || batchCount < 1 || batchCount > 1000);
  const publicInvalid = !isEdit && form.code_mode === "public" && !/^[A-Za-z0-9-]{3,40}$/.test(form.public_code.trim());
  return (
    form.name.trim().length < 2 ||
    form.value.trim() === "" ||
    Number.isNaN(value) ||
    value <= 0 ||
    (form.discount_type === "percent" && value > 100) ||
    (form.valid_from !== "" && form.valid_until !== "" && form.valid_until < form.valid_from) ||
    batchInvalid ||
    publicInvalid ||
    !isValidNewMemberDays(form)
  );
}

const optionalNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw));

/** Body POST/PATCH campaign (tanpa kode publik). */
export function campaignPayload(form: CampaignForm): PromoCampaignFormValues {
  return {
    name: form.name.trim(),
    discount_type: form.discount_type,
    value: Number(form.value),
    max_discount: form.discount_type === "percent" ? optionalNumber(form.max_discount) : null,
    min_purchase: Number(form.min_purchase) || 0,
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    usage_limit: optionalNumber(form.usage_limit),
    per_phone_limit: optionalNumber(form.per_phone_limit),
    scope: form.scope,
    target_product_ids: form.target_product_ids,
    target_category_ids: form.target_category_ids,
    eligibility: form.eligibility,
    new_member_days: form.eligibility === "member_baru" ? optionalNumber(form.new_member_days) : null,
  };
}

export const formatCampaignDiscount = (c: Pick<PromoCampaign, "discount_type" | "value" | "max_discount">) =>
  c.discount_type === "percent"
    ? `${Number(c.value)}%${c.max_discount ? ` (maks ${formatRupiah(c.max_discount)})` : ""}`
    : formatRupiah(c.value);

export const formatCampaignWindow = (c: Pick<PromoCampaign, "valid_from" | "valid_until">) =>
  !c.valid_from && !c.valid_until ? "Tanpa batas waktu" : `${c.valid_from ?? "…"} s/d ${c.valid_until ?? "…"}`;

/** CSV voucher untuk diunduh admin: code,usage_limit,usage_count,is_active. */
export function codesCsv(codes: readonly { code: string; usage_limit: number | null; usage_count: number; is_active: boolean }[]) {
  return [
    "code,usage_limit,usage_count,is_active",
    ...codes.map((c) => `${c.code},${c.usage_limit ?? ""},${c.usage_count},${c.is_active ? "1" : "0"}`),
  ].join("\n");
}
