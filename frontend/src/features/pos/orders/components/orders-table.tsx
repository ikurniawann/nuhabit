"use client";

import { Ban, ExternalLink, Eye, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { orderCustomerLabel } from "@/lib/pos/order-customer";
import { canOpenOrderInCashier, type OrderListGroup } from "@/lib/pos/order-list-group";
import { canVoidOrderStatus } from "@/lib/pos/void-order";
import { isPaid } from "../order-list-rules";
import type { Order } from "../types";
import { PaymentBadge, PaymentStatusBadge, TypeBadge } from "./order-badges";

export type OrderRow = OrderListGroup<Order>;

const HEADERS = ["Order / Antrian", "Date", "Customer", "Type", "Items", "Payment"];

export function OrdersTable({
  rows,
  onOpenInCashier,
  onDetail,
  onVoid,
}: {
  rows: OrderRow[];
  onOpenInCashier: (row: OrderRow) => void;
  onDetail: (order: Order, siblings: Order[]) => void;
  onVoid: (order: Order) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200/70">
      <table className="w-full min-w-[780px] text-sm">
        <thead>
          <tr className="border-b border-gray-200/70 bg-muted/30 text-left text-muted-foreground">
            {HEADERS.map((header) => (
              <th key={header} className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="w-px whitespace-nowrap px-3 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <OrderTableRow
              key={row.kind === "checkout" ? row.checkoutId : row.order.id}
              row={row}
              onOpenInCashier={onOpenInCashier}
              onDetail={onDetail}
              onVoid={onVoid}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTableRow({
  row,
  onOpenInCashier,
  onDetail,
  onVoid,
}: {
  row: OrderRow;
  onOpenInCashier: (row: OrderRow) => void;
  onDetail: (order: Order, siblings: Order[]) => void;
  onVoid: (order: Order) => void;
}) {
  const isMixed = row.kind === "checkout";
  const order = isMixed ? row.orders[0] : row.order;
  if (!order) return null;
  const children = isMixed ? row.orders : [order];
  const total = isMixed ? row.total : Number(order.total_amount) || 0;
  const itemCount = children.reduce((sum, child) => sum + (child.items?.length || 0), 0);

  return (
    <tr className="border-b border-gray-200/70 last:border-0 hover:bg-muted/20">
      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
        <div>{isMixed ? row.checkoutNumber : order.order_number}</div>
        {isMixed && row.orders.length > 1 ? (
          <div className="mt-0.5 space-y-0.5 font-sans text-[11px] font-medium text-brand-text">
            <div>Gabungan {row.orders.length} stall</div>
            <div className="font-mono font-normal text-muted-foreground">
              {row.orders
                .map((child) => child.order_number)
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ) : order.queue_number ? (
          <div className="mt-0.5 text-[11px] font-bold text-brand-text">Antrian {order.queue_number}</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.ordered_at, "—")}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{orderCustomerLabel(order)}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <TypeBadge type={order.order_type} />
      </td>
      <td className="px-4 py-3 tabular-nums text-muted-foreground">{itemCount}</td>
      <td className="px-4 py-3">
        <PaymentBadge order={order} />
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatRupiah(Math.abs(total))}</td>
      <td className="px-4 py-3">
        <PaymentStatusBadge order={order} paid={isMixed ? row.paid : isPaid(order)} />
      </td>
      <td className="w-px whitespace-nowrap px-3 py-3">
        <div className="inline-flex items-center justify-end gap-1">
          {canOpenOrderInCashier(children) ? (
            <Button
              type="button"
              size="icon"
              className="h-8 w-8 bg-primary hover:bg-primary/90"
              title="Open in cashier"
              aria-label="Open in cashier"
              onClick={() => onOpenInCashier(row)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 border-gray-200/80"
            title="Detail"
            aria-label="Detail"
            onClick={() => onDetail(order, isMixed ? row.orders : [])}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {canVoidOrderStatus(order.status) ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 border-red-200/80 text-red-700 hover:bg-red-50"
              title="Void order"
              aria-label="Void order"
              onClick={() => onVoid(order)}
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
