import { DEFAULT_COUNTRY, toE164 } from "./phone";

export interface TrialValues {
  branch_slug: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_country: string;
  phone_local: string;
  consent_email: boolean;
  consent_sms: boolean;
}

export type TrialField = keyof TrialValues;

export const EMPTY_TRIAL: TrialValues = {
  branch_slug: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_country: DEFAULT_COUNTRY,
  phone_local: "",
  consent_email: false,
  consent_sms: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pesan galat per field; kosong berarti form siap dikirim. */
export function validateTrial(values: TrialValues): Partial<Record<TrialField, string>> {
  const errors: Partial<Record<TrialField, string>> = {};
  if (!values.branch_slug) errors.branch_slug = "Pilih cabang";
  if (values.first_name.trim().length === 0) errors.first_name = "Nama depan wajib diisi";
  if (values.first_name.trim().length > 80) errors.first_name = "Nama depan terlalu panjang";
  if (values.last_name.trim().length > 80) errors.last_name = "Nama belakang terlalu panjang";
  const email = values.email.trim();
  if (email.length === 0) errors.email = "Email wajib diisi";
  else if (email.length > 150 || !EMAIL_RE.test(email)) errors.email = "Email tidak valid";
  if (values.phone_local.trim().length === 0) errors.phone_local = "Nomor telepon wajib diisi";
  else if (!toE164(values.phone_country, values.phone_local)) errors.phone_local = "Nomor telepon tidak valid";
  return errors;
}

/** Body POST /api/public/site/trial dari isian yang sudah valid. */
export function trialPayload(values: TrialValues, extra: { utm: Record<string, string>; source_path: string; form_started_at: number }) {
  return {
    branch_slug: values.branch_slug,
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    email: values.email.trim(),
    phone: toE164(values.phone_country, values.phone_local),
    consent_email: values.consent_email,
    consent_sms: values.consent_sms,
    utm: extra.utm,
    source_path: extra.source_path,
    form_started_at: extra.form_started_at,
  };
}
