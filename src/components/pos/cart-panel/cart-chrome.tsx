"use client";

import { Loader2, ShoppingBag, Trash2, Truck, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CartHeader({
  itemCount,
  orderType,
  selectedTable,
  continuingCheckoutNumber,
  onClearCart,
}: {
  itemCount: number;
  orderType: "dine_in" | "takeaway" | "delivery" | "self_order";
  selectedTable: string | null;
  continuingCheckoutNumber: string | null;
  onClearCart?: () => void;
}) {
  return (
    <div className="border-b border-gray-200/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Order</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {itemCount} items
          </span>
          {onClearCart && (
            <button
              type="button"
              disabled={itemCount === 0}
              onClick={onClearCart}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
                itemCount === 0
                  ? "cursor-not-allowed border-gray-200/70 text-muted-foreground/50"
                  : "border-red-200/80 text-red-600 hover:bg-red-50",
              )}
              title="Kosongkan keranjang"
              aria-label="Kosongkan keranjang"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {orderType === "dine_in" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-brand-text">
            <Utensils className="h-3 w-3" /> Dine-in
          </span>
        )}
        {orderType === "takeaway" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
            <ShoppingBag className="h-3 w-3" /> Takeaway
          </span>
        )}
        {orderType === "delivery" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
            <Truck className="h-3 w-3" /> Delivery
          </span>
        )}
        {orderType === "dine_in" && selectedTable ? (
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-brand-text">
            Table {selectedTable}
          </span>
        ) : null}
        {continuingCheckoutNumber ? (
          <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Open bill {continuingCheckoutNumber}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Tombol Order (open bill) & Pay; tanpa shift aktif keduanya dikunci. */
export function CartActions({
  canTransact,
  onOpenShift,
  empty,
  isSavingBill,
  orderLabel,
  payLabel,
  onOpenBill,
  onPay,
}: {
  canTransact: boolean;
  onOpenShift?: () => void;
  empty: boolean;
  isSavingBill: boolean;
  orderLabel: string;
  payLabel: string;
  onOpenBill: () => void;
  onPay: () => void;
}) {
  return (
    <div className="space-y-1.5 border-t border-gray-200/70 px-3 py-2">
      {!canTransact && (
        <div className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
          Open a shift to pay or save orders.{" "}
          {onOpenShift && (
            <button
              type="button"
              onClick={onOpenShift}
              className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
            >
              Open shift
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onOpenBill}
          disabled={empty || isSavingBill || !canTransact}
          className="h-11 w-[38%] shrink-0 border-amber-200/80 font-semibold text-amber-700 hover:bg-amber-50/80"
        >
          {isSavingBill ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            orderLabel
          )}
        </Button>
        <Button
          type="button"
          onClick={onPay}
          disabled={empty || !canTransact}
          className="h-11 min-w-0 flex-1 bg-primary text-base font-semibold hover:bg-primary/90"
        >
          {payLabel}
        </Button>
      </div>
    </div>
  );
}
