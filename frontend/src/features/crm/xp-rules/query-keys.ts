import type { XpRulesListParams } from "./types";

export const xpRulesQueryKeys = {
  all: ["crm", "xp-rules"] as const,
  list: (params: XpRulesListParams) => ["crm", "xp-rules", "list", params] as const,
};
