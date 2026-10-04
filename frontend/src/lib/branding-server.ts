import "server-only";
import { queryOne } from "@/lib/db";
import { brandName, pickBrandName } from "@/lib/branding";

/**
 * Nama merek untuk dokumen yang dihasilkan server (ekspor Excel, watermark,
 * email). Diambil dari perusahaan pemilik data supaya satu basis kode bisa
 * melayani beberapa perusahaan; jatuh ke app_settings lalu env bila kosong.
 */

async function settingBrand(): Promise<string | null> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM configuration.app_settings WHERE key = 'app_brand_name'`
  ).catch(() => null);
  const raw = row?.value;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "name" in (raw as Record<string, unknown>)) {
    return String((raw as { name?: unknown }).name ?? "");
  }
  return null;
}

async function companyName(companyId: string | null | undefined): Promise<string | null> {
  if (!companyId) return null;
  const row = await queryOne<{ name: string | null }>(
    `SELECT name FROM configuration.companies WHERE id = $1`,
    [companyId]
  ).catch(() => null);
  return row?.name ?? null;
}

/** Perusahaan default venue (dipakai saat user super admin tanpa scope). */
async function defaultCompanyId(): Promise<string | null> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM crm.crm_settings WHERE key = 'default_company_id'`
  ).catch(() => null);
  const raw = row?.value;
  if (!raw) return null;
  return typeof raw === "string" ? raw : String(raw).replace(/"/g, "") || null;
}

export async function resolveBrandName(companyId?: string | null): Promise<string> {
  const fromCompany = await companyName(companyId);
  if (fromCompany?.trim()) return fromCompany.trim();
  const fromDefault = await companyName(await defaultCompanyId());
  return pickBrandName(fromDefault, await settingBrand(), brandName());
}
