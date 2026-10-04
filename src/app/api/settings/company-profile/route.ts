import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getSettings, setSetting, SETTING_KEYS } from "@/lib/settings/app-settings";

/**
 * GET/PUT /api/settings/company-profile — profil legal perusahaan untuk
 * dokumen kontrak kerja (nama PT, alamat, kota, penandatangan). Disimpan di
 * configuration.app_settings (key company_*).
 */

const FIELDS = {
  legal_name: SETTING_KEYS.COMPANY_LEGAL_NAME,
  address: SETTING_KEYS.COMPANY_ADDRESS,
  city: SETTING_KEYS.COMPANY_CITY,
  signer_name: SETTING_KEYS.COMPANY_SIGNER_NAME,
  signer_title: SETTING_KEYS.COMPANY_SIGNER_TITLE,
} as const;

type Field = keyof typeof FIELDS;
const FIELD_NAMES = Object.keys(FIELDS) as Field[];

const field = z.string().max(500).nullable().optional();
const putSchema = z.object(Object.fromEntries(FIELD_NAMES.map((name) => [name, field])) as Record<Field, typeof field>);

export const GET = apiHandler(async () => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const settings = await getSettings(Object.values(FIELDS));
  const data = Object.fromEntries(FIELD_NAMES.map((name) => [name, settings[FIELDS[name]]]));
  return NextResponse.json({ data });
}, "GET /api/settings/company-profile");

export const PUT = apiHandler(async (request: NextRequest) => {
  await requireIamMenuPrefix(IAM.settingsBusiness);
  const body = await validateBody(request, putSchema);
  for (const name of FIELD_NAMES) {
    const value = body[name];
    if (value === undefined) continue;
    await setSetting(FIELDS[name], value ? value.trim() : null);
  }
  return NextResponse.json({ message: "Profil perusahaan tersimpan" });
}, "PUT /api/settings/company-profile");
