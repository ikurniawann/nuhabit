export const orgChartQueryKeys = {
  all: ["hris", "org-chart"] as const,
  employees: () => ["hris", "org-chart", "employees"] as const,
  departments: () => ["hris", "org-chart", "departments"] as const,
};
