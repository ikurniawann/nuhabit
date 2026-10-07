import { branchPriceNote } from "../lib/plans";
import type { PublicPlansView } from "../types";
import { PlanGroups } from "./plan-card";
import { Container, Section, SectionHeading } from "./site-section";

/** /join without a plan: the branch's price list, one "Choose" per plan. */
export function JoinPlans({ plans, missingPlan }: { plans: PublicPlansView; missingPlan: boolean }) {
  return (
    <Section>
      <Container className="space-y-8">
        <SectionHeading as="h1" kicker="Membership" title="Choose a Membership" text={branchPriceNote(plans.branch)} />
        {missingPlan ? <p className="text-sm text-danger">The plan you picked is not available at this branch. Choose another plan.</p> : null}
        <PlanGroups plans={plans.plans} branchSlug={plans.branch?.slug} columns="sm:grid-cols-2 lg:grid-cols-3" />
      </Container>
    </Section>
  );
}
