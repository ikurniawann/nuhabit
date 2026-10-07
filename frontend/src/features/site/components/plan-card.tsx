"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { planPayload, pushSiteEvent } from "../lib/analytics";
import { creditsLabel, groupPlans, joinHref, validityLabel } from "../lib/plans";
import type { PublicPlan } from "../types";
import { EmptyNote } from "./site-section";

interface PlanCardProps {
  plan: PublicPlan;
  branchSlug?: string | null;
  onSelect?: () => void;
}

/** One plan: name, badge, branch price, what it grants, and the "Pilih" link to /join. */
export function PlanCard({ plan, branchSlug, onSelect }: PlanCardProps) {
  const select = () => {
    pushSiteEvent("plan_select", planPayload(plan, branchSlug));
    onSelect?.();
  };
  return (
    <article className="flex h-full flex-col gap-3 rounded-card bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-display text-lg font-semibold">{plan.name}</h4>
        {plan.badge ? <Badge variant="accent">{plan.badge}</Badge> : null}
      </div>
      <p className="font-display text-2xl font-bold tabular-nums">{formatRupiah(plan.price_idr)}</p>
      <ul className="space-y-1 text-sm text-body">
        <li>{creditsLabel(plan)}</li>
        <li>Berlaku {validityLabel(plan.validity_days)}</li>
      </ul>
      {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}
      <Button asChild className="mt-auto">
        <Link href={joinHref(plan.id, branchSlug)} onClick={select}>
          Pilih
        </Link>
      </Button>
    </article>
  );
}

/** The plans of a branch in two groups, "Pass" then "Paket Kredit". */
export function PlanGroups({
  plans,
  branchSlug,
  columns = "sm:grid-cols-2 lg:grid-cols-4",
  onSelect,
}: {
  plans: PublicPlan[];
  branchSlug?: string | null;
  /** Grid columns above the single phone column. */
  columns?: string;
  onSelect?: () => void;
}) {
  const groups = groupPlans(plans);
  if (groups.length === 0) return <EmptyNote>Belum ada paket membership untuk cabang ini.</EmptyNote>;
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.kind} aria-label={group.label} className="space-y-3">
          <h3 className="font-display text-base font-semibold tracking-wide uppercase">{group.label}</h3>
          <div className={cn("grid grid-cols-1 gap-4", columns)}>
            {group.plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} branchSlug={branchSlug} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
