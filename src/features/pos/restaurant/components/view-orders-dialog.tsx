"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, ReceiptText, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import type { Order } from "@/features/pos/open-bills/types";
import type { PosTable } from "@/lib/pos-api";
import { cn } from "@/lib/utils";

import { formatOrderElapsed } from "../order-elapsed";
import { orderToPreviewReceipt } from "../order-to-receipt";
import { PaymentProofBadge } from "@/features/pos/open-bills/payment-proof-badge";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(Number(value)) ? Math.abs(Number(value)) : 0);

function formatClockTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function OrderElapsed({ value }: { value?: string }) {
  const [label, setLabel] = useState("-");

  useEffect(() => {
    const tick = () => setLabel(formatOrderElapsed(value));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [value]);

  return <span suppressHydrationWarning>{label}</span>;
}

function getTableDisplayName(table?: PosTable) {
  return table?.label || table?.table_number || table?.name || null;
}

function resolveOrderTableLabel(
  order: Order,
  tablesById: Map<string, PosTable>
) {
  if (order.table_id) {
    const tableName = getTableDisplayName(tablesById.get(order.table_id));
    if (tableName) return tableName;
  }
  if (order.table?.table_number) return order.table.table_number;
  if (order.table?.qr_code) return order.table.qr_code;
  return order.table_id ? "Meja" : "Without table";
}

function isOpenBill(order: Order) {
  return (
    !["completed", "cancelled", "voided", "merged"].includes(order.status || "") &&
    (order.payment_status || "unpaid") !== "paid"
  );
}

function resolveCustomerLabel(order: Order) {
  const name = order.customer?.name?.trim();
  const phone = order.customer?.phone?.trim();
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return "Walk-in";
}

function OrderDetailPanel({
  order,
  tableLabel,
}: {
  order: Order;
  tableLabel: string;
}) {
  const payload = orderToPreviewReceipt(order, tableLabel);
  const customerLabel = resolveCustomerLabel(order);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Detail Order</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          <span className="font-mono font-medium text-gray-700">
            {order.order_number || order.id.slice(0, 8)}
          </span>
          {` · ${tableLabel} · since ${formatClockTime(order.ordered_at)}`}
        </p>
        <p className="mt-1 text-sm text-gray-800">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Customer
          </span>
          <span className="mt-0.5 block font-medium">{customerLabel}</span>
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-200/70">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50/95">
            <tr className="border-b border-gray-200/70 text-left text-xs font-medium text-gray-500">
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payload.items.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No items on this bill.
                </td>
              </tr>
            ) : (
              payload.items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-200/70 last:border-b-0"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.variantName ? (
                      <div className="text-xs text-gray-500">{item.variantName}</div>
                    ) : null}
                    {item.modifierNames?.length ? (
                      <div className="text-xs text-gray-500">
                        {item.modifierNames.join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">
                    {formatCurrency(item.price * item.quantity)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-1.5 rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-3 text-sm">
        {payload.discountAmount > 0 ? (
          <div className="flex justify-between gap-3 text-gray-600">
            <span>Discount</span>
            <span className="tabular-nums">
              -{formatCurrency(payload.discountAmount)}
            </span>
          </div>
        ) : null}
        {payload.chargesBreakdown && payload.chargesBreakdown.length > 0
          ? payload.chargesBreakdown.map((line) => (
              <div
                key={line.code}
                className="flex justify-between gap-3 text-gray-600"
              >
                <span>{line.name}</span>
                <span className="tabular-nums">
                  {line.amount < 0 ? "-" : ""}
                  {formatCurrency(Math.abs(line.amount))}
                </span>
              </div>
            ))
          : payload.taxAmount > 0 ? (
              <div className="flex justify-between gap-3 text-gray-600">
                <span>Tax</span>
                <span className="tabular-nums">
                  {formatCurrency(payload.taxAmount)}
                </span>
              </div>
            ) : null}
        <div className="flex justify-between gap-3 font-semibold text-gray-900">
          <span>Total</span>
          <span className="tabular-nums">{formatCurrency(payload.total)}</span>
        </div>
        <div className="flex justify-between gap-3 text-xs font-medium text-amber-700">
          <span>Waiting</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="size-3.5" />
            <OrderElapsed value={order.ordered_at} />
          </span>
        </div>
        <div className="flex justify-between gap-3 text-xs font-medium text-amber-700">
          <span>Status</span>
          <span>UNPAID</span>
        </div>
      </div>

      {payload.notes ? (
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-800">Notes: </span>
          {payload.notes}
        </p>
      ) : null}
    </div>
  );
}

export interface ViewOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tablesById: Map<string, PosTable>;
  onSelectOrder?: (order: Order) => void;
}

export function ViewOrdersDialog({
  open,
  onOpenChange,
  tablesById,
  onSelectOrder,
}: ViewOrdersDialogProps) {
  const { data: orders = [], isLoading, error, isFetching } = useOpenBills({
    limit: 200,
  });
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const openBills = useMemo(() => {
    return [...orders.filter(isOpenBill)].sort((a, b) => {
      const aTime = new Date(a.ordered_at || 0).getTime();
      const bTime = new Date(b.ordered_at || 0).getTime();
      return aTime - bTime;
    });
  }, [orders]);

  const detailOrder = useMemo(() => {
    if (!detailOrderId) return null;
    return openBills.find((order) => order.id === detailOrderId) ?? null;
  }, [detailOrderId, openBills]);

  useEffect(() => {
    if (!open) {
      setDetailOrderId(null);
      return;
    }
    if (detailOrderId && !openBills.some((o) => o.id === detailOrderId)) {
      setDetailOrderId(null);
    }
  }, [open, detailOrderId, openBills]);

  const errorMessage = error instanceof Error ? error.message : null;
  const detailTableLabel = detailOrder
    ? resolveOrderTableLabel(detailOrder, tablesById)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="xl">
        <DialogPanelHeader>
          <DialogPanelTitle>View Orders</DialogPanelTitle>
          <DialogPanelDescription>
            Click an order number to see Detail Order
            {isFetching && !isLoading ? " · refreshing…" : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-gray-500">
              <Loader2 className="size-4 animate-spin" />
              Loading orders...
            </div>
          ) : errorMessage ? (
            <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
              {errorMessage}
            </div>
          ) : openBills.length === 0 ? (
            <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-8 text-center">
              <ReceiptText className="mx-auto size-8 text-gray-400" />
              <p className="mt-3 text-sm font-semibold text-gray-900">
                No open orders
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Active bills will appear here.
              </p>
            </div>
          ) : (
            <div className="grid min-h-[min(55vh,480px)] gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <div className="overflow-hidden rounded-lg border border-gray-200/70">
                <div className="max-h-[min(55vh,480px)] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm">
                      <tr className="border-b border-gray-200/70 text-left text-xs font-medium text-gray-500">
                        <th className="px-3 py-2.5">Order</th>
                        <th className="px-3 py-2.5">Table</th>
                        <th className="px-3 py-2.5">Customer</th>
                        <th className="px-3 py-2.5 text-right">Total</th>
                        <th className="px-3 py-2.5 text-right">Waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openBills.map((order) => {
                        const tableLabel = resolveOrderTableLabel(
                          order,
                          tablesById
                        );
                        const orderedClock = formatClockTime(order.ordered_at);
                        const selected = detailOrderId === order.id;

                        return (
                          <tr
                            key={order.id}
                            className={cn(
                              "cursor-pointer border-b border-gray-200/70 last:border-b-0",
                              selected
                                ? "bg-primary/5 ring-1 ring-inset ring-primary/30"
                                : "hover:bg-primary/5"
                            )}
                            onClick={() => setDetailOrderId(order.id)}
                          >
                            <td className="px-3 py-2.5">
                              <button
                                type="button"
                                className="text-left font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDetailOrderId(order.id);
                                }}
                              >
                                {order.order_number || order.id.slice(0, 8)}
                              </button>
                              <div className="mt-0.5 text-xs text-gray-500">
                                since {orderedClock}
                              </div>
                              <PaymentProofBadge order={order} />
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-1.5 text-gray-700">
                                <Table2 className="size-3.5 shrink-0 text-gray-400" />
                                <span className="truncate">{tableLabel}</span>
                              </span>
                            </td>
                            <td className="max-w-[140px] truncate px-3 py-2.5 text-gray-700">
                              {resolveCustomerLabel(order)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">
                              {formatCurrency(Number(order.total_amount || 0))}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="inline-flex items-center justify-end gap-1.5 text-xs font-semibold tabular-nums text-amber-700">
                                <Clock className="size-3.5 shrink-0" />
                                <OrderElapsed value={order.ordered_at} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200/70 bg-white p-3 sm:p-4">
                {detailOrder ? (
                  <OrderDetailPanel
                    order={detailOrder}
                    tableLabel={detailTableLabel}
                  />
                ) : (
                  <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-4 text-center">
                    <ReceiptText className="size-8 text-gray-300" />
                    <p className="mt-3 text-sm font-semibold text-gray-900">
                      Detail Order
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Click an order number on the left to view customer, items, and totals.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/70"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {onSelectOrder && detailOrder ? (
            <Button
              type="button"
              onClick={() => {
                onSelectOrder(detailOrder);
                onOpenChange(false);
              }}
            >
              Select bill
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
