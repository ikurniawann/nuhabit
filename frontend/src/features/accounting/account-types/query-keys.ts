export const accountTypesQueryKeys = {
  all: ["accounting", "account-types"] as const,
  list: () => [...accountTypesQueryKeys.all, "list"] as const,
};
