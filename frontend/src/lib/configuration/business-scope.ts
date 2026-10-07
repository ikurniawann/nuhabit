export type BusinessScopeLevel = "holding" | "company" | "branch";

export interface BusinessScopeInput {
  business_scope?: BusinessScopeLevel | null;
  holding_id?: string | null;
  company_id?: string | null;
  branch_id?: string | null;
}

export const BUSINESS_SCOPE_LABELS: Record<BusinessScopeLevel, string> = {
  holding: "Holding",
  company: "Company",
  branch: "Branch",
};

export const BUSINESS_SCOPE_DESCRIPTIONS: Record<BusinessScopeLevel, string> = {
  holding: "Can view all companies and branches within the selected holding.",
  company: "Can only view branches within the selected company.",
  branch: "Can only view data for the selected branch.",
};

export function normalizeBusinessScopePayload(
  scope: BusinessScopeLevel | null | undefined,
  holdingId?: string | null,
  companyId?: string | null,
  branchId?: string | null
): BusinessScopeInput {
  if (!scope) {
    return {
      business_scope: null,
      holding_id: null,
      company_id: null,
      branch_id: null,
    };
  }

  if (scope === "holding") {
    return {
      business_scope: "holding",
      holding_id: holdingId ?? null,
      company_id: null,
      branch_id: null,
    };
  }

  if (scope === "company") {
    return {
      business_scope: "company",
      holding_id: holdingId ?? null,
      company_id: companyId ?? null,
      branch_id: null,
    };
  }

  return {
    business_scope: "branch",
    holding_id: holdingId ?? null,
    company_id: companyId ?? null,
    branch_id: branchId ?? null,
  };
}

export function validateBusinessScope(
  role: string | undefined,
  isAccessApp: boolean,
  input: BusinessScopeInput
): string | null {
  if (!isAccessApp) return null;
  if (!role || role === "super_admin") return null;

  if (!input.business_scope) {
    return "Data access scope is required for this role";
  }

  if (input.business_scope === "holding" && !input.holding_id) {
    return "Holding is required";
  }

  if (input.business_scope === "company") {
    if (!input.holding_id || !input.company_id) {
      return "Holding and company are required";
    }
  }

  if (input.business_scope === "branch") {
    if (!input.holding_id || !input.company_id || !input.branch_id) {
      return "Holding, company, and branch are required";
    }
  }

  return null;
}
