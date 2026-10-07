import Link from "next/link";
import { Button } from "@/components/ui/button";
import { branchPriceNote } from "../lib/plans";
import type { PublicPlansView } from "../types";
import { PlanGroups } from "./plan-card";
import { Container, Section, SectionHeading } from "./site-section";

/** The home page's "Pilih Membership" strip: the remembered branch's plans, each linking to /join. */
export function MembershipSection({ plans }: { plans: PublicPlansView }) {
  if (plans.plans.length === 0) return null;
  const slug = plans.branch?.slug ?? undefined;
  return (
    <Section className="bg-surface">
      <Container className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading kicker="Membership" title="Pilih Membership" text={branchPriceNote(plans.branch)} />
          <Button asChild variant="outline">
            <Link href={slug ? `/join?branch=${encodeURIComponent(slug)}` : "/join"}>Semua paket</Link>
          </Button>
        </div>
        <PlanGroups plans={plans.plans} branchSlug={slug} />
      </Container>
    </Section>
  );
}
