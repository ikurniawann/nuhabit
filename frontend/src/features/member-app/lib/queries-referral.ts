"use client";

import { useQuery } from "@tanstack/react-query";
import { deviceId, type ReferralDiscount } from "@/lib/member-portal/referral";
import { memberApi } from "./api";
import { m } from "./links";

export type ReferralStatus = "joined" | "held" | "rewarded" | "capped" | "void" | "blocked";

export interface ReferralView {
  code: string;
  program: {
    active: boolean;
    referrer_credits: number;
    referrer_ark_idr: number;
    referee_credits: number;
    referee_discount: ReferralDiscount | null;
    hold_days: number;
  };
  stats: { invited: number; joined: number; rewarded: number };
  friends: { name: string; status: ReferralStatus; joined_at: string; settled_at: string | null }[];
  welcome: { referrer_name: string; voucher_code: string | null; status: ReferralStatus } | null;
}

export const referralKey = ["member-app", "referral"] as const;

/** The "Invite friends" screen; the device id feeds the same-device guard. */
export function useReferral() {
  return useQuery({
    queryKey: referralKey,
    queryFn: () => memberApi<ReferralView>("/app/referral", { headers: { "X-Device-Id": deviceId() } }),
  });
}

/** English dictionary keys for a friend's status, as the referrer sees it. */
export const FRIEND_STATUS: Record<ReferralStatus, string> = {
  joined: "Signed up",
  held: "Bought a package",
  rewarded: "Rewarded",
  capped: "Monthly limit reached",
  void: "Refunded",
  blocked: "Not eligible",
};

/** The share link: the member app sign-up with the code. */
export function referralLink(origin: string, code: string): string {
  return `${origin}${m("/auth/register")}?ref=${encodeURIComponent(code)}`;
}
