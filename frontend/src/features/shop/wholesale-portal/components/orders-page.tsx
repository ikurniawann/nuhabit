"use client";

import Link from "next/link";
import { Loader2, Package } from "lucide-react";
import { formatRupiah } from "@/lib/format";
import { formatDateEn, formatDateTimeEn } from "@/lib/shop/format-en";
import { useWholesaleOrders, type WholesaleOrderRow } from "../queries";
import { payLaterPendingLabel, statusOf, TERMS_LABEL } from "./order-status";
import { useRequireAccount } from "./use-require-account";

export const orderStatusLabel = (order: Pick<WholesaleOrderRow, "status" | "payment_terms">) =>
  order.status === "pending" && order.payment_terms === "pay_later" ? payLaterPendingLabel : statusOf(order.status).label;

const lineCount = (count: string) => `${count} ${Number(count) === 1 ? "line" : "lines"}`;

/** /wholesale/orders: the partner's order history with status. */
export function WholesaleOrdersPage() {
  const { account, loading } = useRequireAccount();
  const orders = useWholesaleOrders(account !== null);
  const rows = orders.data ?? [];

  if (loading || !account || orders.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-forest" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">History</p>
        <h1 className="text-2xl font-bold">
          Orders<span className="text-forest">.</span>
        </h1>
      </div>
      {orders.isError ? (
        <p className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">{orders.error.message}</p>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card bg-card py-20 text-muted-foreground shadow-card">
          <Package className="h-10 w-10 opacity-40" />
          <p className="text-sm">No orders yet</p>
          <Link href="/wholesale/catalog" className="text-sm font-semibold text-forest">
            Open the catalog
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((order) => {
            const status = statusOf(order.status);
            return (
              <li key={order.id}>
                <Link
                  href={`/wholesale/orders/${order.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-card p-4 shadow-card hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{order.order_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeEn(order.created_at)} · {lineCount(order.item_count)} · {TERMS_LABEL[order.payment_terms]}
                      {order.due_at && order.payment_terms === "pay_later" ? ` · due ${formatDateEn(order.due_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{formatRupiah(order.total)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.tone}`}>
                      {orderStatusLabel(order)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
