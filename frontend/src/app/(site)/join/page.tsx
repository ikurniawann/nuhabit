import type { Metadata } from "next";
import { cookies } from "next/headers";
import { JoinCheckout } from "@/features/site/components/join-checkout";
import { JoinPlans } from "@/features/site/components/join-plans";
import { ReferralBanner } from "@/features/site/components/referral-banner";
import { BRANCH_COOKIE } from "@/features/site/lib/branch-cookie";
import { fetchPlans } from "@/features/site/lib/public-api";
import { MEMBER_SESSION_COOKIE } from "@/lib/member-portal/session";

export const metadata: Metadata = { title: "Membership" };

type Props = { searchParams: Promise<{ plan?: string; branch?: string; ref?: string }> };

/** One route for the checkout: ?plan picks the plan, ?branch its price, ?step the screen, ?ref a friend's referral code. */
export default async function Page({ searchParams }: Props) {
  const { plan: planId, branch, ref } = await searchParams;
  const cookieStore = await cookies();
  const slug = branch || cookieStore.get(BRANCH_COOKIE)?.value || undefined;
  const plans = await fetchPlans(slug);
  const plan = planId ? plans.plans.find((p) => p.id === planId) : undefined;
  return (
    <>
      <ReferralBanner code={ref} />
      {plan ? (
        <JoinCheckout plan={plan} branch={plans.branch} hasSessionCookie={Boolean(cookieStore.get(MEMBER_SESSION_COOKIE)?.value)} />
      ) : (
        <JoinPlans plans={plans} missingPlan={Boolean(planId)} />
      )}
    </>
  );
}
