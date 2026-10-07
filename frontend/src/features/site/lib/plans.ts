import type { PublicPlan, PublicPlanBranch } from "../types";

export const PLAN_GROUP_LABELS = { pass: "Pass", credits: "Paket Kredit" } as const;
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

/** "7 hari", "4 minggu", "6 bulan". */
export function validityLabel(days: number): string {
  if (days >= 180) return `${Math.round(days / 30.4)} bulan`;
  if (days >= 28 && days % 7 === 0) return `${days / 7} minggu`;
  return `${days} hari`;
}

export function creditsLabel(plan: Pick<PublicPlan, "kind" | "credits">): string {
  return plan.kind === "pass" ? "Booking kelas tanpa batas" : `${plan.credits} kredit kelas`;
}

export function joinHref(planId: string, branchSlug?: string | null): string {
  const params = new URLSearchParams({ plan: planId });
  if (branchSlug) params.set("branch", branchSlug);
  return `/join?${params}`;
}

/** Under a price list: whose prices these are. */
export function branchPriceNote(branch: PublicPlanBranch | null): string {
  return branch ? `Harga berlaku di ${branch.name}. Ganti cabang lewat pilihan di footer.` : "Harga dasar. Pilih cabang di footer untuk harga cabang.";
}
