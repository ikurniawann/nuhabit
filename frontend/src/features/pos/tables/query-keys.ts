export const posTablesQueryKeys = {
  all: ["pos", "tables"] as const,
  list: (includeInactive: boolean) =>
    [...posTablesQueryKeys.all, "list", { includeInactive }] as const,
};
