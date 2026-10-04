export const JOURNAL_ENTRY_ROUTES = {
  list: "/dashboard/accounting/journal-entries",
  history: "/dashboard/accounting/journal-history",
  new: "/dashboard/accounting/journal-entries/insert",
  edit: (id: string) => `/dashboard/accounting/journal-entries/edit/${id}`,
} as const;
