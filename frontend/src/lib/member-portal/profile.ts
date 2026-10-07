/**
 * Kelengkapan profil member (EPIC-011 Fase D, keputusan owner #9-10):
 * 100% lengkap → Free XP sekali seumur hidup. Murni & teruji.
 */

export interface MemberProfileFields {
  name: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  city: string | null;
  photo_url: string | null;
  /** consent promo WA dihitung "terisi" bila sudah menentukan pilihan (bukan null) */
  wa_consent: boolean | null;
}

export const PROFILE_FIELD_LABELS: Record<keyof MemberProfileFields, string> = {
  name: "Nama",
  phone: "No. WhatsApp",
  email: "Email",
  birth_date: "Tanggal lahir",
  gender: "Jenis kelamin",
  city: "Kota/domisili",
  photo_url: "Foto profil",
  wa_consent: "Pilihan promo WA",
};

export interface ProfileCompletion {
  percent: number;
  missing: (keyof MemberProfileFields)[];
  complete: boolean;
}

const isFilled = (
  key: keyof MemberProfileFields,
  value: MemberProfileFields[keyof MemberProfileFields]
): boolean => {
  if (key === "wa_consent") return value !== null && value !== undefined;
  return typeof value === "string" && value.trim() !== "";
};

export function computeProfileCompletion(
  fields: MemberProfileFields
): ProfileCompletion {
  const keys = Object.keys(PROFILE_FIELD_LABELS) as (keyof MemberProfileFields)[];
  const missing = keys.filter((key) => !isFilled(key, fields[key]));
  const filled = keys.length - missing.length;
  const percent = Math.round((filled / keys.length) * 100);
  return { percent, missing, complete: missing.length === 0 };
}
