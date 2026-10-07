export type CrmCustomer = {
  id: string;
  name: string;
  phone: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
  total_spent: number;
  visit_count: number;
};

export type CrmXpActivity = {
  id: string;
  direction: string;
  source_channel: string;
  source_type: string;
  xp_delta: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  member?: {
    member_code: string;
    customer_id: string;
  } | null;
};

export type CrmDashboardData = {
  stats: {
    totalCustomers: number;
    totalMembers: number;
    cardMembers: number;
    registeredMembers: number;
    arkOutstanding: number;
    tierCount: number;
    xpRuleCount: number;
    rewardCount: number;
    avatarCount: number;
    redemptionCount: number;
    externalEventCount: number;
  };
  topLoyalMembers: CrmCustomer[];
  topTransactionSpenders: CrmCustomer[];
  topArkSpenders: { customer: CrmCustomer | null; ark_coins_used: number }[];
  recentXpActivity: CrmXpActivity[];
};

export type CrmDashboardResult = {
  data: CrmDashboardData;
  schemaReady: boolean;
};
