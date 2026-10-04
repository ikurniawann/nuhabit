import { NextRequest, NextResponse } from "next/server";
import { ApiError, getApiUser, requireIamMenuPrefix } from "@/lib/api/auth";
import { apiHandler } from "@/lib/api/handler";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import {
  canAccessAppearanceCompany,
  getCompanyAppearance,
  listAccessibleAppearanceCompanies,
  resolveDefaultCompanyId,
  saveCompanyAppearance,
} from "@/lib/theme/company-appearance";
import { parseAppearanceTokens } from "@/lib/theme/appearance-tokens";

type Companies = Awaited<ReturnType<typeof listAccessibleAppearanceCompanies>>;

function appearanceData(companyId: string | null, companies: Companies, theme: ReturnType<typeof parseAppearanceTokens>) {
  const company = companyId ? companies.find((c) => c.id === companyId) : undefined;
  return { company_id: companyId, company_name: company?.name ?? null, companies, theme };
}

async function requireScope() {
  const scope = await getApiUserScope();
  if (!scope) throw ApiError.unauthorized("Authentication required");
  return scope;
}

/** Tema perusahaan; tanpa sesi → tema default (dipakai halaman login). */
export const GET = apiHandler(async (request: NextRequest) => {
  if (!(await getApiUser())) {
    return NextResponse.json({ data: appearanceData(null, [], parseAppearanceTokens(null)) });
  }
  const scope = await requireScope();
  const companies = await listAccessibleAppearanceCompanies(scope);
  const requested = request.nextUrl.searchParams.get("company_id");
  const requestedAllowed = requested ? canAccessAppearanceCompany(scope, requested) : false;
  const companyId = requested && requestedAllowed ? requested : resolveDefaultCompanyId(scope, companies);

  if (!companyId) {
    return NextResponse.json({ data: appearanceData(null, companies, parseAppearanceTokens(null)) });
  }
  if (requested && !requestedAllowed) throw ApiError.forbidden("Company tidak dapat diakses");
  return NextResponse.json({ data: appearanceData(companyId, companies, await getCompanyAppearance(companyId)) });
}, "GET /api/settings/appearance");

export const PUT = apiHandler(async (request: NextRequest) => {
  const user = await requireIamMenuPrefix(IAM.settingsAppearance);
  const scope = await requireScope();
  const body = ((await request.json()) ?? {}) as { company_id?: unknown; theme?: unknown };
  const companyId = typeof body.company_id === "string" ? body.company_id : "";
  if (!companyId) throw ApiError.badRequest("company_id wajib");
  if (!canAccessAppearanceCompany(scope, companyId)) throw ApiError.forbidden("Company tidak dapat diakses");

  const companies = await listAccessibleAppearanceCompanies(scope);
  if (!companies.some((c) => c.id === companyId)) throw ApiError.notFound("Company tidak ditemukan");

  const theme = await saveCompanyAppearance(companyId, parseAppearanceTokens(body.theme), user.id);
  return NextResponse.json({
    message: "Tema perusahaan tersimpan",
    data: appearanceData(companyId, companies, theme),
  });
}, "PUT /api/settings/appearance");
