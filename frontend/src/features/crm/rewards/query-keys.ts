import type { RedemptionsListParams, RewardsListParams } from "./types";

export const rewardsQueryKeys = {
  all: ["crm", "rewards"] as const,
  list: (params: RewardsListParams) => ["crm", "rewards", "list", params] as const,
};

export const redemptionsQueryKeys = {
  all: ["crm", "redemptions"] as const,
  list: (params: RedemptionsListParams) => ["crm", "redemptions", "list", params] as const,
};
