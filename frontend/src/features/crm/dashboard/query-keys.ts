export const dashboardQueryKeys = {
  all: ["crm", "dashboard"] as const,
  summary: () => ["crm", "dashboard", "summary"] as const,
};
