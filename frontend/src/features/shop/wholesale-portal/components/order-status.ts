const WHOLESALE_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Menunggu Pembayaran", tone: "bg-warning-soft text-warning" },
  paid: { label: "Dibayar", tone: "bg-success-soft text-success" },
  packing: { label: "Dikemas", tone: "bg-info-soft text-info" },
  shipped: { label: "Dikirim", tone: "bg-info-soft text-info" },
  completed: { label: "Selesai", tone: "bg-success-soft text-success" },
  cancelled: { label: "Dibatalkan", tone: "bg-danger-soft text-danger" },
  refund: { label: "Refund", tone: "bg-surface text-muted-foreground" },
};

export const statusOf = (status: string) =>
  WHOLESALE_STATUS[status] ?? { label: status, tone: "bg-surface text-muted-foreground" };

/** Label status pesanan pay_later yang belum dibayar. */
export const payLaterPendingLabel = "Belum dibayar (jatuh tempo)";

export const TERMS_LABEL = { invoice: "Invoice Xendit", pay_later: "Bayar nanti (30 hari)" } as const;
