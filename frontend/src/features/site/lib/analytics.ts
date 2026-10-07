// dataLayer events of the public site (GTM). Sent only when window.dataLayer
// exists, which the site layout creates when a GTM container id is set.

import type { PublicPlan } from "../types";

export type SiteEvent = "plan_select" | "checkout_start";

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown>> };

export function pushSiteEvent(event: SiteEvent, payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const layer = (window as DataLayerWindow).dataLayer;
  if (!Array.isArray(layer)) return;
  layer.push({ event, ...payload });
}

/** The plan fields both membership events carry. */
export function planPayload(plan: PublicPlan, branchSlug: string | null | undefined) {
  return { plan_id: plan.id, plan_name: plan.name, kind: plan.kind, branch: branchSlug ?? null, value: plan.price_idr };
}
