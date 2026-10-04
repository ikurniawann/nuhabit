"use client";

import { CheckCircle, Clock, CreditCard, Merge, Truck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPaymentMethodLabel } from "@/lib/pos/reports/transaction-labels";
import { cn } from "@/lib/utils";
import type { Order } from "../types";

const STATUS_BADGES: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  voided: { label: "Void", className: "bg-muted text-muted-foreground", icon: XCircle },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700", icon: XCircle },
  merged: { label: "Merged", className: "bg-indigo-50 text-indigo-800", icon: Merge },
};

/**
 * Badge status di LIST = status PEMBAYARAN, bukan status dapur (EPIC-041
 * task 6, keputusan owner): order lunas berstatus fulfilment 'pending' sampai
 * KDS men-serve semua item, jadi badge "Pending" pada order lunas menyesatkan.
 */
export function PaymentStatusBadge({ order, paid }: { order: Order; paid: boolean }) {
  const meta =
    STATUS_BADGES[String(order.status || "")] ??
    (paid
      ? { label: "Lunas", className: "bg-emerald-50 text-emerald-800", icon: CheckCircle }
      : { label: "Belum bayar", className: "bg-amber-50 text-amber-800", icon: Clock });
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("gap-1 font-medium", meta.className)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

const TYPE_LABELS: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
  self_order: "Self-order",
};

export function TypeBadge({ type, prominent = false }: { type?: string | null; prominent?: boolean }) {
  const value = String(type || "");
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-gray-200/80 bg-white font-medium text-foreground",
        // Header "Order detail" (owner 2026-10-01): tipe harus langsung terlihat.
        prominent && "px-2.5 py-1 text-sm font-semibold",
        prominent && value === "dine_in" && "border-primary/30 bg-primary/10 text-brand-text",
        prominent && value === "takeaway" && "border-amber-300 bg-amber-50 text-amber-700",
        prominent && value === "delivery" && "border-emerald-300 bg-emerald-50 text-emerald-700"
      )}
    >
      {value === "delivery" ? <Truck className="mr-1 h-3 w-3" /> : null}
      {TYPE_LABELS[value] || value || "—"}
    </Badge>
  );
}

export function PaymentBadge({ order }: { order: Order }) {
  const label = formatPaymentMethodLabel(order.payment_method, {
    code: order.payment_method_code,
    name: order.payment_method_name,
  });
  if (label === "—") return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className="gap-1 border-gray-200/80 bg-white font-medium text-foreground">
      <CreditCard className="h-3 w-3" />
      {label}
    </Badge>
  );
}
