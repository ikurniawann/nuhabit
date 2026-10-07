import type {
  BusinessTree,
  BusinessTreeNode,
  BusinessEntityType,
  BusinessHolding,
  BusinessCompany,
  BusinessBranch,
} from "../types";

export interface FlatBusinessTreeRow {
  node: BusinessTreeNode;
  depth: number;
  hasChildren: boolean;
  isLast: boolean;
  parentContinuations: boolean[];
}

interface BusinessTreeNodeInternal {
  id: string;
  kind: BusinessEntityType;
  node: BusinessTreeNode;
  children: BusinessTreeNodeInternal[];
}

function buildInternalTree(tree: BusinessTree): BusinessTreeNodeInternal[] {
  return tree.holdings.map((holding) => ({
    id: holding.id,
    kind: "holding" as const,
    node: { kind: "holding", level: 0, data: holding },
    children: holding.companies.map((company) => ({
      id: company.id,
      kind: "company" as const,
      node: { kind: "company", level: 1, data: company, holdingId: holding.id },
      children: company.branches.map((branch) => ({
        id: branch.id,
        kind: "branch" as const,
        node: { kind: "branch", level: 2, data: branch, companyId: company.id },
        children: branch.warehouses.map((warehouse) => ({
          id: warehouse.id,
          kind: "warehouse" as const,
          node: {
            kind: "warehouse",
            level: 3,
            data: warehouse,
            branchId: branch.id,
          },
          children: [],
        })),
      })),
    })),
  }));
}

export function flattenBusinessTreeDisplay(
  tree: BusinessTree,
  expandedIds: Set<string>,
  depth = 0,
  parentContinuations: boolean[] = [],
  nodes?: BusinessTreeNodeInternal[],
): FlatBusinessTreeRow[] {
  const roots = nodes ?? buildInternalTree(tree);
  const rows: FlatBusinessTreeRow[] = [];

  roots.forEach((entry, index) => {
    const hasChildren = entry.children.length > 0;
    const isLast = index === roots.length - 1;

    rows.push({
      node: entry.node,
      depth,
      hasChildren,
      isLast,
      parentContinuations: [...parentContinuations],
    });

    if (hasChildren && expandedIds.has(entry.id)) {
      rows.push(
        ...flattenBusinessTreeDisplay(
          tree,
          expandedIds,
          depth + 1,
          [...parentContinuations, !isLast],
          entry.children,
        ),
      );
    }
  });

  return rows;
}

export function collectExpandableBusinessIds(tree: BusinessTree): string[] {
  const ids: string[] = [];

  const walkHoldings = (holdings: BusinessHolding[]) => {
    for (const holding of holdings) {
      if (holding.companies.length > 0) ids.push(holding.id);
      walkCompanies(holding.companies);
    }
  };

  const walkCompanies = (companies: BusinessCompany[]) => {
    for (const company of companies) {
      if (company.branches.length > 0) ids.push(company.id);
      walkBranches(company.branches);
    }
  };

  const walkBranches = (branches: BusinessBranch[]) => {
    for (const branch of branches) {
      if (branch.warehouses.length > 0) ids.push(branch.id);
    }
  };

  walkHoldings(tree.holdings);
  return ids;
}

export function countBusinessEntities(tree: BusinessTree) {
  let companies = 0;
  let branches = 0;
  let warehouses = 0;

  for (const holding of tree.holdings) {
    companies += holding.companies.length;
    for (const company of holding.companies) {
      branches += company.branches.length;
      for (const branch of company.branches) {
        warehouses += branch.warehouses.length;
      }
    }
  }

  return {
    holdings: tree.holdings.length,
    companies,
    branches,
    warehouses,
  };
}
