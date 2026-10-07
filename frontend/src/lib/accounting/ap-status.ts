import type { ApAgingBucket, ApPaymentStatus } from "@/lib/accounting/ap-types";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeInvoiceOutstanding(
  totalAmount: number,
  allocatedAmount: number
): number {
  return Math.max(0, round2(Number(totalAmount) || 0) - round2(Number(allocatedAmount) || 0));
}

export function resolvePaymentStatus(opts: {
  totalAmount: number;
  allocatedAmount: number;
  dueDate?: string | null;
  today?: string;
}): ApPaymentStatus {
  const outstanding = computeInvoiceOutstanding(
    opts.totalAmount,
    opts.allocatedAmount
  );
  if (outstanding <= 0.009) return "paid";
  const allocated = round2(Number(opts.allocatedAmount) || 0);
  if (allocated > 0.009) {
    // Still check overdue for remaining balance
    if (isPastDue(opts.dueDate, opts.today)) return "overdue";
    return "partial";
  }
  if (isPastDue(opts.dueDate, opts.today)) return "overdue";
  return "unpaid";
}

function isPastDue(dueDate?: string | null, today?: string): boolean {
  if (!dueDate) return false;
  const asOf = today || new Date().toISOString().slice(0, 10);
  return dueDate < asOf;
}

/** Days past due; negative = not yet due. */
export function daysPastDue(dueDate: string | null | undefined, asOf: string): number {
  if (!dueDate) return 0;
  const due = Date.parse(`${dueDate}T00:00:00`);
  const asOfMs = Date.parse(`${asOf}T00:00:00`);
  if (!Number.isFinite(due) || !Number.isFinite(asOfMs)) return 0;
  return Math.floor((asOfMs - due) / (24 * 60 * 60 * 1000));
}

export function bucketAging(
  outstanding: number,
  dueDate: string | null | undefined,
  asOf: string
): ApAgingBucket | null {
  if (round2(outstanding) <= 0) return null;
  const days = daysPastDue(dueDate, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}
