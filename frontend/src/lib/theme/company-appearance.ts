import { query, queryOne } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import {
  DEFAULT_APPEARANCE,
  parseAppearanceTokens,
  type AppearanceTokens,
} from "./appearance-tokens";

export type AppearanceCompany = { id: string; name: string };

export async function listAccessibleAppearanceCompanies(
  scope: UserScope
): Promise<AppearanceCompany[]> {
  if (scope.isUnscoped || scope.role === "super_admin") {
    return query<AppearanceCompany>(
      `SELECT id, name
       FROM configuration.companies
       WHERE is_active = true
       ORDER BY name`
    );
  }
  if (!scope.companyId) return [];
  return query<AppearanceCompany>(
    `SELECT id, name
     FROM configuration.companies
     WHERE id = $1 AND is_active = true`,
    [scope.companyId]
  );
}

export function canAccessAppearanceCompany(scope: UserScope, companyId: string): boolean {
  if (scope.isUnscoped || scope.role === "super_admin") {
    return true;
  }
  return scope.companyId === companyId;
}

export async function getCompanyAppearance(companyId: string): Promise<AppearanceTokens> {
  const row = await queryOne<{ theme: unknown }>(
    `SELECT theme FROM configuration.company_appearance WHERE company_id = $1`,
    [companyId]
  );
  return parseAppearanceTokens(row?.theme ?? null);
}

export async function saveCompanyAppearance(
  companyId: string,
  theme: AppearanceTokens,
  updatedBy: string | null
): Promise<AppearanceTokens> {
  const parsed = parseAppearanceTokens(theme);
  await query(
    `INSERT INTO configuration.company_appearance (company_id, theme, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (company_id) DO UPDATE SET
       theme = EXCLUDED.theme,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by`,
    [companyId, JSON.stringify(parsed), updatedBy]
  );
  return parsed;
}

export function resolveDefaultCompanyId(
  scope: UserScope,
  companies: AppearanceCompany[]
): string | null {
  if (scope.companyId && companies.some((c) => c.id === scope.companyId)) {
    return scope.companyId;
  }
  return companies[0]?.id ?? null;
}

export { DEFAULT_APPEARANCE };
