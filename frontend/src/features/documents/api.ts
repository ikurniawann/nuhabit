import { apiGet, buildListUrl } from "@/lib/api-client";

/** Kop dokumen dari profil perusahaan (GET /api/settings/letterhead). */
export interface Letterhead {
  legal_name: string;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  npwp: string | null;
  website: string | null;
  logo_url: string;
  custom_logo: boolean;
}

export const fetchLetterhead = (companyId?: string | null) =>
  apiGet<{ data: Letterhead }>(
    buildListUrl("/api/settings/letterhead", { company_id: companyId }),
  ).then((r) => r.data);
