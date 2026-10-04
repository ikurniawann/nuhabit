"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Equal,
  Minus,
  Plus,
  Split,
  Users,
  UtensilsCrossed,
} from "lucide-react";

import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import { cn } from "@/lib/utils";

import {
  buildEqualSplits,
  buildPerItemSplits,
  countUnassignedQty,
  guestLabel,
  normalizeAssignments,
  resizeLabels,
} from "./split-bill-calc";

export interface SplitItemMapping {
  order_item_index: number;
  quantity: number;
  product_id: string;
  product_name: string;
  unit_price: number;
}

export interface SplitConfig {
  mode: "equal" | "per-item";
  count: number;
  splits: {
    label: string;
    customerId?: string;
    total: number;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    items?: SplitItemMapping[];
  }[];
}

type SplitMode = SplitConfig["mode"];

interface SplitBillModalProps {
  open: boolean;
  total: number;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  cartItems: PosCartItem[];
  onClose: () => void;
  onConfirm: (config: SplitConfig) => void;
  formatCurrency: (n: number) => string;
  confirming?: boolean;
}

/** Isi modal di-mount ulang tiap dibuka → mode, jumlah tamu & label kembali ke awal. */
export function SplitBillModal(props: SplitBillModalProps) {
  if (!props.open) return null;
  return <SplitBillBody {...props} />;
}

function SplitBillBody({
  total,
  taxAmount,
  discountAmount,
  cartItems,
  onClose,
  onConfirm,
  formatCurrency,
  confirming = false,
}: SplitBillModalProps) {
  const [mode, setMode] = useState<SplitMode>("equal");
  const [count, setCount] = useState(2);
  const [labels, setLabels] = useState<string[]>(["", ""]);
  const [assignments, setAssignments] = useState(() => normalizeAssignments({}, cartItems, 2));

  // Keranjang berubah saat modal terbuka → sesuaikan pembagian (pola "adjust state on prop change").
  const [seenCartItems, setSeenCartItems] = useState(cartItems);
  if (seenCartItems !== cartItems) {
    setSeenCartItems(cartItems);
    setAssignments(normalizeAssignments(assignments, cartItems, count));
  }

  const changeCount = (next: number) => {
    setCount(next);
    setAssignments(normalizeAssignments(assignments, cartItems, next));
    setLabels(resizeLabels(labels, next));
  };

  const equalSplits = useMemo(
    () =>
      buildEqualSplits({
        count,
        total,
        taxAmount,
        discountAmount,
        labels,
      }),
    [count, total, taxAmount, discountAmount, labels]
  );

  const perItemSplits = useMemo(
    () =>
      buildPerItemSplits({
        count,
        cartItems: cartItems.map((item) => ({
          id: item.id,
          name: item.name,
          productId: item.productId,
          price: item.price,
          quantity: item.quantity,
        })),
        assignments,
        taxAmount,
        discountAmount,
        labels,
      }),
    [count, cartItems, assignments, taxAmount, discountAmount, labels]
  );

  const unassignedTotal = useMemo(
    () =>
      mode === "per-item"
        ? countUnassignedQty(cartItems, assignments)
        : 0,
    [mode, cartItems, assignments]
  );

  const splitsToRender = mode === "equal" ? equalSplits : perItemSplits;
  const splitTotalSum = splitsToRender.reduce((sum, s) => sum + s.total, 0);

  const isValid = useMemo(() => {
    if (mode === "equal") {
      return equalSplits.reduce((sum, s) => sum + s.total, 0) === total;
    }
    return unassignedTotal === 0 && cartItems.length > 0;
  }, [mode, equalSplits, total, unassignedTotal, cartItems.length]);

  const handleDecrease = () => changeCount(Math.max(2, count - 1));
  const handleIncrease = () => changeCount(count + 1);

  const handleLabelChange = (idx: number, val: string) => {
    setLabels((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const handleQtyChange = (itemId: string, splitIdx: number, delta: number) => {
    setAssignments((prev) => {
      const item = cartItems.find((i) => i.id === itemId);
      if (!item) return prev;
      const arr = [...(prev[itemId] || Array(count).fill(0))];
      const currentAssigned = arr.reduce((a, b) => a + b, 0);
      const available = item.quantity - (currentAssigned - arr[splitIdx]);
      const nextVal = Math.max(0, Math.min(arr[splitIdx] + delta, available));
      if (nextVal === arr[splitIdx]) return prev;
      arr[splitIdx] = nextVal;
      return { ...prev, [itemId]: arr };
    });
  };

  const handleSetQty = (itemId: string, splitIdx: number, val: number) => {
    setAssignments((prev) => {
      const item = cartItems.find((i) => i.id === itemId);
      if (!item) return prev;
      const arr = [...(prev[itemId] || Array(count).fill(0))];
      const currentAssigned = arr.reduce(
        (a, b, idx) => a + (idx === splitIdx ? 0 : b),
        0
      );
      const maxVal = Math.max(0, item.quantity - currentAssigned);
      arr[splitIdx] = Math.max(0, Math.min(val, maxVal));
      return { ...prev, [itemId]: arr };
    });
  };

  const handleConfirm = () => {
    if (!isValid || confirming) return;

    if (mode === "equal") {
      onConfirm({
        mode: "equal",
        count,
        splits: equalSplits.map((s) => ({
          label: s.label,
          total: s.total,
          subtotal: s.total - s.tax + s.discount,
          tax_amount: s.tax,
          discount_amount: s.discount,
        })),
      });
      return;
    }

    const splits: SplitConfig["splits"] = perItemSplits.map((s, splitIdx) => {
      const items: SplitItemMapping[] = [];
      cartItems.forEach((item, itemIdx) => {
        const qty = assignments[item.id]?.[splitIdx] || 0;
        if (qty > 0) {
          items.push({
            order_item_index: itemIdx,
            quantity: qty,
            product_id: item.productId,
            product_name: item.name,
            unit_price: item.price,
          });
        }
      });
      return {
        label: s.label,
        subtotal: s.subtotal,
        tax_amount: s.tax,
        discount_amount: s.discount,
        total: s.total,
        items,
      };
    });
    onConfirm({ mode: "per-item", count, splits });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !confirming && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-brand-text" />
            Split Bill
          </DialogPanelTitle>
          <DialogPanelDescription>
            Split equally or by item · Bill total {formatCurrency(total)}
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-4">
          <div className="flex rounded-lg border border-gray-200/70 bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setMode("equal")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                mode === "equal"
                  ? "bg-white text-brand-text shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Equal className="h-4 w-4" />
              Split equally
            </button>
            <button
              type="button"
              onClick={() => setMode("per-item")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium transition-colors",
                mode === "per-item"
                  ? "bg-white text-brand-text shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UtensilsCrossed className="h-4 w-4" />
              Split by item
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-gray-200/70 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Guests</p>
                <p className="text-xs text-muted-foreground">
                  {mode === "equal"
                    ? "Divide the bill evenly"
                    : "Assign each item to a guest"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 border-gray-200/80"
                onClick={handleDecrease}
                disabled={count <= 2 || confirming}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center text-lg font-bold text-foreground">
                {count}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 border-gray-200/80"
                onClick={handleIncrease}
                disabled={confirming}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {mode === "per-item" && (
            <div className="space-y-3">
              {cartItems.length === 0 ? (
                <div className="rounded-lg border border-gray-200/70 bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                  No items on this bill.
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    className="grid items-end gap-2 text-center text-[10px] text-muted-foreground"
                    style={{
                      gridTemplateColumns: `1fr repeat(${count + 1}, minmax(48px, 1fr))`,
                    }}
                  >
                    <div className="pl-1 text-left">Item / price</div>
                    {Array.from({ length: count }, (_, i) => (
                      <div key={i} className="leading-tight">
                        {labels[i]?.trim() || guestLabel(i)}
                      </div>
                    ))}
                    <div>Left</div>
                  </div>

                  {cartItems.map((item) => {
                    const arr = assignments[item.id] || Array(count).fill(0);
                    const assigned = arr.reduce((a, b) => a + b, 0);
                    const remaining = Math.max(0, item.quantity - assigned);
                    return (
                      <div
                        key={item.id}
                        className="space-y-1.5 rounded-lg border border-gray-200/70 bg-muted/20 p-2"
                      >
                        <div className="flex items-center justify-between gap-2 px-1 text-xs">
                          <span className="truncate font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatCurrency(item.price)} × {item.quantity}
                          </span>
                        </div>
                        <div
                          className="grid items-center gap-2"
                          style={{
                            gridTemplateColumns: `1fr repeat(${count + 1}, minmax(48px, 1fr))`,
                          }}
                        >
                          <div className="pl-1 text-[10px] text-muted-foreground">
                            Sub {formatCurrency(item.price * item.quantity)}
                          </div>
                          {Array.from({ length: count }, (_, splitIdx) => (
                            <div
                              key={splitIdx}
                              className="flex items-center justify-center"
                            >
                              <div className="flex h-7 items-center overflow-hidden rounded-md border border-gray-200/80 bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQtyChange(item.id, splitIdx, -1)
                                  }
                                  disabled={confirming}
                                  className="px-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={item.quantity}
                                  value={arr[splitIdx] || 0}
                                  disabled={confirming}
                                  onChange={(e) =>
                                    handleSetQty(
                                      item.id,
                                      splitIdx,
                                      parseInt(e.target.value, 10) || 0
                                    )
                                  }
                                  className="w-6 border-0 p-0 text-center text-xs font-semibold text-foreground focus:ring-0"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleQtyChange(item.id, splitIdx, 1)
                                  }
                                  disabled={confirming}
                                  className="px-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          ))}
                          <div
                            className={cn(
                              "text-center text-xs font-bold",
                              remaining > 0
                                ? "text-red-600"
                                : "text-emerald-600"
                            )}
                          >
                            {remaining}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {unassignedTotal > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {unassignedTotal} item qty still unassigned.
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {Array.from({ length: count }, (_, idx) => {
              const s = splitsToRender[idx];
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-lg border border-gray-200/70 bg-muted/20 p-3"
                >
                  <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Input
                      placeholder={guestLabel(idx)}
                      value={labels[idx] || ""}
                      onChange={(e) => handleLabelChange(idx, e.target.value)}
                      disabled={confirming}
                      className="h-8 border-gray-200/80 bg-white text-sm"
                    />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-brand-text">
                      {formatCurrency(s?.total || 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {mode === "per-item" ? (
                        <>
                          Sub {formatCurrency(s?.subtotal || 0)} · Tax{" "}
                          {formatCurrency(s?.tax || 0)} · Disc{" "}
                          {formatCurrency(s?.discount || 0)}
                        </>
                      ) : (
                        <>
                          Tax {formatCurrency(s?.tax || 0)} · Disc{" "}
                          {formatCurrency(s?.discount || 0)}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-1 text-sm">
            <span className="text-muted-foreground">Split total</span>
            <span className="font-bold text-foreground">
              {formatCurrency(splitTotalSum)}
            </span>
          </div>

          {mode === "equal" && splitTotalSum !== total && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Split total ({formatCurrency(splitTotalSum)}) must equal the bill (
              {formatCurrency(total)}).
            </div>
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={onClose}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-primary hover:bg-primary/90"
            onClick={handleConfirm}
            disabled={!isValid || confirming}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            {confirming ? "Creating…" : "Create split"}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
