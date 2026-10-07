export const FISCAL_YEAR_ROUTES = {
  list: "/dashboard/accounting/fiscal-years",
  new: "/dashboard/accounting/fiscal-years/insert",
  edit: (id: string) => `/dashboard/accounting/fiscal-years/edit/${id}`,
  beginningBalance: (id: string) =>
    `/dashboard/accounting/fiscal-years/beginning-balance/${id}`,
} as const;
