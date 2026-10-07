export const stockAlertsQueryKeys = {
  all: ["pos", "stock-alerts"] as const,
  list: () => [...stockAlertsQueryKeys.all, "list"] as const,
};
