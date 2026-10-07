export const billingSettingsQueryKeys = {
  all: ["pos", "billing-settings"] as const,
  options: (branchId?: string | null) =>
    ["pos", "billing-settings", "options", branchId ?? null] as const,
  resolve: (branchId?: string | null, warehouseId?: string | null) =>
    ["pos", "billing-settings", "resolve", branchId ?? null, warehouseId ?? null] as const,
};
