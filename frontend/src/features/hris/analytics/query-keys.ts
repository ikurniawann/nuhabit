export const analyticsQueryKeys = {
  all: ["hris", "analytics"] as const,
  brands: () => ["hris", "analytics", "brands"] as const,
  data: (brandFilter: string, period: string) =>
    ["hris", "analytics", "data", brandFilter, period] as const,
};
