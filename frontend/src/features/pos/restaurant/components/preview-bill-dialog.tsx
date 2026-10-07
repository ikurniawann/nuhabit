"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

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
import { printThermalReceipt, type ReceiptPayload } from "@/components/pos/PrintReceipt";
import { formatRupiah } from "@/lib/format";

const formatCurrency = (value: number) => formatRupiah(Math.abs(Number(value) || 0));

export interface PreviewBillDialogProps {
  open: boolean;
  payload: ReceiptPayload | null;
  onOpenChange: (open: boolean) => void;
  /** When false, footer only has Close (Order Check). Default true for Pre Settlement. */
  showPrint?: boolean;
  title?: string;
  descriptionPrefix?: string;
}

export function PreviewBillDialog({
  open,
  payload,
  onOpenChange,
  showPrint = true,
  title = "Preview Bill",
  descriptionPrefix = "Pre-settlement · unpaid",
}: PreviewBillDialogProps) {
  const [printing, setPrinting] = useState(false);

  const handlePrint = () => {
    if (!payload || printing || !showPrint) return;
    try {
      setPrinting(true);
      printThermalReceipt(payload, "PREVIEW_BILL");
    } finally {
      // Allow a short beat so the button shows loading before popup steals focus.
      window.setTimeout(() => setPrinting(false), 400);
    }
  };

  const orderLabel =
    payload?.orderNumber ||
    (payload?.orderId ? payload.orderId.slice(0, 8).toUpperCase() : "—");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>
            {descriptionPrefix}
            {payload?.table ? ` · ${payload.table}` : ""}
            {` · Order #${orderLabel}`}
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-4">
          {!payload ? (
            <p className="text-sm text-gray-500">No bill to preview.</p>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Customer
                </p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">
                  {payload.customerName?.trim() || "Walk-in"}
                </p>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200/70">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200/70 bg-gray-50/80 text-left text-xs font-medium text-gray-500">
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
                          className="px-3 py-6 text-center text-sm text-gray-500"
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
                            <div className="font-medium text-gray-900">
                              {item.name}
                            </div>
                            {item.variantName ? (
                              <div className="text-xs text-gray-500">
                                {item.variantName}
                              </div>
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
                  <span className="tabular-nums">
                    {formatCurrency(payload.total)}
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
            </>
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/70"
            onClick={() => onOpenChange(false)}
            disabled={printing}
          >
            Close
          </Button>
          {showPrint ? (
            <Button
              type="button"
              onClick={handlePrint}
              disabled={!payload || printing}
            >
              {printing ? (
                "Printing..."
              ) : (
                <>
                  <Printer className="size-4" />
                  Print
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
