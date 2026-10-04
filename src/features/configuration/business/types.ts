export type BusinessEntityType = "holding" | "company" | "branch" | "warehouse";

export interface BusinessWarehouse {
  id: string;
  branch_id: string;
  name: string;
  code: string;
  is_default: boolean;
  is_active: boolean;
}

export interface BusinessBranch {
  id: string;
  company_id: string;
  name: string;
  code: string;
  is_active: boolean;
  warehouses: BusinessWarehouse[];
}

export interface BusinessCompany {
  id: string;
  holding_id: string;
  name: string;
  code: string;
  is_active: boolean;
  branches: BusinessBranch[];
}

export interface BusinessHolding {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  companies: BusinessCompany[];
}

export interface BusinessTree {
  holdings: BusinessHolding[];
}

export interface CreateBusinessPayload {
  type: BusinessEntityType;
  name: string;
  code?: string;
  parentId?: string;
  is_active?: boolean;
}

export interface UpdateBusinessPayload {
  name?: string;
  code?: string;
  is_active?: boolean;
}

export type BusinessTreeNode =
  | { kind: "holding"; level: 0; data: BusinessHolding }
  | { kind: "company"; level: 1; data: BusinessCompany; holdingId: string }
  | { kind: "branch"; level: 2; data: BusinessBranch; companyId: string }
  | { kind: "warehouse"; level: 3; data: BusinessWarehouse; branchId: string };

export const BUSINESS_LEVEL_LABELS: Record<BusinessEntityType, string> = {
  holding: "Holding",
  company: "Company",
  branch: "Branch",
  warehouse: "Stall",
};

export const BUSINESS_CHILD_TYPE: Partial<
  Record<BusinessEntityType, BusinessEntityType>
> = {
  holding: "company",
  company: "branch",
  branch: "warehouse",
};

export function flattenBusinessTree(tree: BusinessTree): BusinessTreeNode[] {
  const rows: BusinessTreeNode[] = [];

  for (const holding of tree.holdings) {
    rows.push({ kind: "holding", level: 0, data: holding });
    for (const company of holding.companies) {
      rows.push({
        kind: "company",
        level: 1,
        data: company,
        holdingId: holding.id,
      });
      for (const branch of company.branches) {
        rows.push({
          kind: "branch",
          level: 2,
          data: branch,
          companyId: company.id,
        });
        for (const warehouse of branch.warehouses) {
          rows.push({
            kind: "warehouse",
            level: 3,
            data: warehouse,
            branchId: branch.id,
          });
        }
      }
    }
  }

  return rows;
}
