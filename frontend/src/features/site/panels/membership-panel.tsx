"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanGroups } from "../components/plan-card";
import { readBranchCookie } from "../shell/panels";
import type { BranchSummary, PublicPlansView } from "../types";

async function readPublic<T>(path: string): Promise<T> {
  const res = await fetch(`/api/public/site${path}`);
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
  if (!res.ok || !json?.success || json.data === undefined) throw new Error(json?.error ?? "Could not load plans");
  return json.data;
}

type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

/** Fetches once per path; until the answer for the current path arrives the state reads as loading. */
function useLoaded<T>(path: string | null): Loaded<T> {
  const [answer, setAnswer] = useState<{ path: string; result: Loaded<T> } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    readPublic<T>(path)
      .then((data) => !cancelled && setAnswer({ path, result: { status: "ready", data } }))
      .catch(() => !cancelled && setAnswer({ path, result: { status: "error" } }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return answer && answer.path === path ? answer.result : { status: "loading" };
}

/**
 * The membership slide-over: a branch picker (prop, then the remembered
 * cookie, then the first public branch) and that branch's plans. "Choose"
 * closes the panel and goes to /join with one plan.
 */
export default function MembershipPanel({ branchSlug, onClose }: { branchSlug?: string; onClose(): void }) {
  // Only mounted in the browser, inside an open Sheet.
  const [picked, setPicked] = useState<string | undefined>(() => branchSlug ?? readBranchCookie(document.cookie));
  const branches = useLoaded<BranchSummary[]>("/branches");
  const slug = picked ?? (branches.status === "ready" ? branches.data[0]?.slug : undefined);
  const plans = useLoaded<PublicPlansView>(slug ? `/plans?branch=${encodeURIComponent(slug)}` : null);

  return (
    <div className="space-y-5">
      {branches.status === "ready" && branches.data.length > 0 ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Branch</span>
          <select
            value={slug ?? ""}
            onChange={(e) => setPicked(e.target.value)}
            className="h-10 rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
          >
            {branches.data.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
                {b.city ? ` · ${b.city}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {plans.status === "error" || branches.status === "error" ? (
        <p className="text-sm text-danger">Plans could not be loaded. Try again in a moment.</p>
      ) : plans.status === "ready" ? (
        <PlanGroups plans={plans.data.plans} branchSlug={plans.data.branch?.slug} columns="" onSelect={onClose} />
      ) : (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-40 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      )}
    </div>
  );
}
