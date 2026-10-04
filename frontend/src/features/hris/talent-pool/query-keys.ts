export const talentPoolQueryKeys = {
  all: ["hris", "talent-pool"] as const,
  list: (brandId?: string) =>
    ["hris", "talent-pool", "list", brandId ?? "all"] as const,
  brands: () => ["hris", "talent-pool", "brands"] as const,
};
