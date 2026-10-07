const WHOLESALE_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Awaiting Payment", tone: "bg-warning-soft text-warning" },
  paid: { label: "Paid", tone: "bg-success-soft text-success" },
  packing: { label: "Packing", tone: "bg-info-soft text-info" },
  shipped: { label: "Shipped", tone: "bg-info-soft text-info" },
  completed: { label: "Completed", tone: "bg-success-soft text-success" },
  cancelled: { label: "Cancelled", tone: "bg-danger-soft text-danger" },
  refund: { label: "Refunded", tone: "bg-surface text-muted-foreground" },
};

export const statusOf = (status: string) =>
  WHOLESALE_STATUS[status] ?? { label: status, tone: "bg-surface text-muted-foreground" };

/** Status label for an unpaid pay_later order. */
export const payLaterPendingLabel = "Unpaid (due later)";

export const TERMS_LABEL = { invoice: "Xendit invoice", pay_later: "Pay later (30 days)" } as const;
