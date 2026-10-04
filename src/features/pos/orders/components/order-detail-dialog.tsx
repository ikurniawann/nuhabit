"use client";

import { useEffect } from "react";
import { Ban, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { printThermalReceipt } from "@/components/pos/PrintReceipt";
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
import { TransactionDetailBody, type TransactionOrderDetail } from "@/features/pos/reports/components/transaction-detail-body";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { canVoidOrderStatus } from "@/lib/pos/void-order";
import { isUnpaid } from "../order-list-rules";
import { checkoutFamilyToReceiptPayload, orderToReceiptPayload } from "../order-to-receipt";
import { flattenOrderItems, mergeBillTransactionDetail, orderToTransactionRow } from "../order-transaction-detail";
import { useOrderTransactionDetail } from "../queries";
import type { Order } from "../types";
import { TypeBadge } from "./order-badges";

function printOrderReceipt(order: Order, siblings: Order[]) {
  // Checkout multi-stall: cetak SEMUA anak-order (fix 2026-08-23).
  const payload = siblings.length > 1 ? checkoutFamilyToReceiptPayload(siblings) : orderToReceiptPayload(order);
  // Bill BELUM dibayar dicetak sebagai PREVIEW BILL (EPIC-043): memuat blok
  // tanda tangan "Disetujui/Nama" untuk arsip persetujuan Owner Comp.
  void printThermalReceipt(payload, isUnpaid(order) ? "PREVIEW_BILL" : "CUSTOMER");
}

export function OrderDetailDialog({
  order,
  siblings,
  onClose,
  onVoid,
  onOwnerComp,
}: {
  order: Order | null;
  siblings: Order[];
  onClose: () => void;
  onVoid: () => void;
  onOwnerComp: () => void;
}) {
  const detail = useOrderTransactionDetail(order);
  const isFamily = siblings.length > 1;

  useEffect(() => {
    if (detail.error) toast.error(detail.error instanceof Error ? detail.error.message : "Gagal memuat detail");
  }, [detail.error]);

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelHeader>
          <DialogPanelTitle className="flex flex-wrap items-center gap-2">
            {isFamily ? order?.checkout_number || "Tagihan gabungan" : "Order detail"}
            {order?.order_type ? <TypeBadge type={order.order_type} prominent /> : null}
          </DialogPanelTitle>
          <DialogPanelDescription>
            {isFamily
              ? siblings
                  .map((child) => child.order_number)
                  .filter(Boolean)
                  .join(" · ")
              : order?.order_number || "Order"}
            {order?.ordered_at ? ` · ${formatDateTime(order.ordered_at)}` : ""}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          {detail.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : order ? (
            <OrderDetail order={order} siblings={siblings} detail={detail.data ?? null} />
          ) : null}
        </DialogPanelBody>
        <DialogFooter>
          {order && canVoidOrderStatus(order.status) ? (
            <Button type="button" variant="outline" className="border-red-200/80 text-red-700 hover:bg-red-50" onClick={onVoid}>
              <Ban className="mr-2 h-4 w-4" />
              Void
            </Button>
          ) : null}
          {order && isUnpaid(order) ? (
            <Button type="button" variant="outline" className="border-gray-200/80" onClick={onOwnerComp}>
              Owner Comp
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={() => order && printOrderReceipt(order, siblings)}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print receipt
          </Button>
          <Button type="button" variant="outline" className="border-gray-200/80" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function OrderDetail({
  order,
  siblings,
  detail,
}: {
  order: Order;
  siblings: Order[];
  detail: TransactionOrderDetail | null;
}) {
  const childOrders = siblings.length > 1 ? siblings : [order];
  const merged = mergeBillTransactionDetail(detail, childOrders);
  const items =
    childOrders.length > 1
      ? flattenOrderItems(childOrders)
      : flattenOrderItems([{ id: order.id, items: detail?.items || order.items }]);

  return (
    <div className="space-y-4">
      {childOrders.length > 1 ? (
        <section className="rounded-lg border border-gray-200/70 bg-card">
          <h3 className="border-b border-gray-200/70 px-3 py-2 text-sm font-semibold text-foreground">Nomor POS per stall</h3>
          <div className="space-y-2 p-3">
            {childOrders.map((child) => {
              const stall = (child as { stall_name?: string | null }).stall_name;
              const count = `${child.items?.length || 0} item`;
              return (
                <div
                  key={child.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-muted/20 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-foreground">{child.order_number || "—"}</div>
                    <div className="text-xs text-muted-foreground">{stall ? `${stall} · ${count}` : count}</div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatRupiah(Math.abs(Number(child.total_amount) || 0))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <TransactionDetailBody row={orderToTransactionRow(order)} detail={merged} items={items} />
    </div>
  );
}
