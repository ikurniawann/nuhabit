import type { PayoutStatus } from "@/lib/gym/incentive";

export const PAYOUT_VARIANT: Record<PayoutStatus, "outline" | "info" | "success" | "muted"> = {
  draft: "outline",
  approved: "info",
  paid: "success",
  void: "muted",
};

/** "YYYY-MM" → "Oktober 2026" (periode statement, bukan instan waktu). */
export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
