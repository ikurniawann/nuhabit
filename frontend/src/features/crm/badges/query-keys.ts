export const badgesQueryKeys = {
  all: ["crm", "badges"] as const,
  list: () => ["crm", "badges", "list"] as const,
};
