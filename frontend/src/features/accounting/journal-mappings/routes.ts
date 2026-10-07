export const JOURNAL_MAPPING_ROUTES = {
  list: "/dashboard/accounting/journal-mappings",
  new: "/dashboard/accounting/journal-mappings/insert",
  edit: (id: string) =>
    `/dashboard/accounting/journal-mappings/edit/${id}`,
} as const;
