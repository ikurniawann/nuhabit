export const salaryQueryKeys = {
  all: ["hris", "salary"] as const,
  list: () => ["hris", "salary", "list"] as const,
  detail: (id: string) => ["hris", "salary", "detail", id] as const,
  employees: () => ["hris", "salary", "employees"] as const,
};
