"use client";

import { usePathname } from "next/navigation";
import { TrialForm } from "@/features/site-forms";

/** The trial slide-over: the lead form, preselecting the panel's branch. */
export default function TrialPanel({ branchSlug }: { branchSlug?: string; onClose(): void }) {
  const pathname = usePathname();
  return <TrialForm defaultBranch={branchSlug} sourcePath={pathname ?? undefined} />;
}
