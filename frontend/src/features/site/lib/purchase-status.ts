/** What the member portal reports for a purchase (GET .../purchases/{id}). */
export interface PurchaseView {
  id: string;
  status: string;
  package_name: string;
  kind: "credits" | "pass";
  credits: number;
  validity_days: number;
  total_idr: number;
  invoice_url: string | null;
  expires_at: string | null;
}

export type PurchaseOutcome = "pending" | "paid" | "expired" | "failed";

/** The status page shows one of four outcomes; refunds and anything unknown read as failed. */
export function purchaseOutcome(status: string): PurchaseOutcome {
  switch (status) {
    case "pending":
    case "paid":
    case "expired":
      return status;
    default:
      return "failed";
  }
}

export const POLL_INTERVAL_MS = 3000;

/** Polling continues only while the invoice can still be paid. */
export function pollInterval(view: PurchaseView | undefined): number | false {
  return view && purchaseOutcome(view.status) === "pending" ? POLL_INTERVAL_MS : false;
}
