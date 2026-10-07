export const dashboardQueryKeys = {
  all: ["hris", "dashboard"] as const,
  brands: () => ["hris", "dashboard", "brands"] as const,
  data: (brandFilter: string, period: string) =>
    ["hris", "dashboard", "data", brandFilter, period] as const,
};
