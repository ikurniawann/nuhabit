import type { PublicPlan, PublicPlanBranch } from "../types";

export const PLAN_GROUP_LABELS = { pass: "Passes", credits: "Credit Packs" } as const;
export type PlanKind = keyof typeof PLAN_GROUP_LABELS;

export interface PlanGroup {
  kind: PlanKind;
  label: string;
  plans: PublicPlan[];
}

/** Passes first, then credit packs; a kind without plans is left out. */
export function groupPlans(plans: PublicPlan[]): PlanGroup[] {
  return (Object.keys(PLAN_GROUP_LABELS) as PlanKind[])
    .map((kind) => ({ kind, label: PLAN_GROUP_LABELS[kind], plans: plans.filter((p) => p.kind === kind) }))
    .filter((group) => group.plans.length > 0);
}

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** "7 days", "4 weeks", "6 months". */
export function validityLabel(days: number): string {
  if (days >= 180) return count(Math.round(days / 30.4), "month");
  if (days >= 28 && days % 7 === 0) return count(days / 7, "week");
  return count(days, "day");
}

export function creditsLabel(plan: Pick<PublicPlan, "kind" | "credits">): string {
  return plan.kind === "pass" ? "Unlimited class bookings" : count(plan.credits, "class credit");
}

export function joinHref(planId: string, branchSlug?: string | null): string {
  const params = new URLSearchParams({ plan: planId });
  if (branchSlug) params.set("branch", branchSlug);
  return `/join?${params}`;
}

/** Under a price list: whose prices these are. */
export function branchPriceNote(branch: PublicPlanBranch | null): string {
  return branch ? `Prices for ${branch.name}. Change branch in the footer.` : "Base prices. Choose a branch in the footer for branch pricing.";
}
