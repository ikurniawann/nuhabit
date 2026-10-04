export const businessQueryKeys = {
  all: ["settings", "business"] as const,
  tree: () => [...businessQueryKeys.all, "tree"] as const,
  receipt: () => [...businessQueryKeys.all, "receipt"] as const,
  companyProfile: () => [...businessQueryKeys.all, "company-profile"] as const,
};
