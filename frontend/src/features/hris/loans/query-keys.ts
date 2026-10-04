export const loanQueryKeys = {
  lists: () => ["hris", "loans", "list"] as const,
  list: (status: string) => ["hris", "loans", "list", status] as const,
};
