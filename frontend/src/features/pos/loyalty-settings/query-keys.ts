export const loyaltySettingsQueryKeys = {
  all: ["pos", "loyalty-settings"] as const,
  detail: () => [...loyaltySettingsQueryKeys.all, "detail"] as const,
};
