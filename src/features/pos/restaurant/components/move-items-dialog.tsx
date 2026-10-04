"use client";

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";

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
import { cn } from "@/lib/utils";

export type MoveItemsLine = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type MoveItemsSelection = {
  order_item_id: string;
  qty: number;
};

interface MoveItemsDialogProps {
  open: boolean;
  lines: MoveItemsLine[];
  formatCurrency: (n: number) => string;
  onClose: () => void;
  onContinue: (items: MoveItemsSelection[]) => void;
}

/** Dirender hanya saat terbuka → qty pilihan selalu mulai dari nol. */
export function MoveItemsDialog(props: MoveItemsDialogProps) {
  return props.open ? <MoveItemsBody {...props} /> : null;
}

function MoveItemsBody({
  lines,
  formatCurrency,
  onClose,
  onContinue,
}: MoveItemsDialogProps) {
  const [qtyById, setQtyById] = useState<Record<string, number>>({});

  // Baris bill berubah saat dialog terbuka → pilihan direset (pola adjust-state-on-prop-change).
  const [seenLines, setSeenLines] = useState(lines);
  if (seenLines !== lines) {
    setSeenLines(lines);
    setQtyById({});
  }

  const selected = useMemo(() => {
    return lines
      .map((line) => ({
        order_item_id: line.id,
        qty: Math.min(
          Math.max(0, Math.floor(qtyById[line.id] || 0)),
          line.quantity
        ),
      }))
      .filter((row) => row.qty > 0);
  }, [lines, qtyById]);

  const totalQty = selected.reduce((sum, row) => sum + row.qty, 0);

  const setQty = (id: string, next: number, max: number) => {
    setQtyById((prev) => ({
      ...prev,
      [id]: Math.min(Math.max(0, next), max),
    }));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>Move Items</DialogPanelTitle>
          <DialogPanelDescription>
            Choose line quantities to move, then tap a destination table.
          </DialogPanelDescription>
        </DialogPanelHeader>

        <DialogPanelBody className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This bill has no items to move.
            </p>
          ) : (
            lines.map((line) => {
              const qty = qtyById[line.id] || 0;
              return (
                <div
                  key={line.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {line.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {line.quantity} available · {formatCurrency(line.unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-gray-200/80"
                      disabled={qty <= 0}
                      onClick={() => setQty(line.id, qty - 1, line.quantity)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span
                      className={cn(
                        "w-8 text-center text-sm font-semibold tabular-nums",
                        qty > 0 ? "text-brand-text" : "text-muted-foreground"
                      )}
                    >
                      {qty}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-gray-200/80"
                      disabled={qty >= line.quantity}
                      onClick={() => setQty(line.id, qty + 1, line.quantity)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </DialogPanelBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-gray-200/80"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={totalQty === 0}
            onClick={() => onContinue(selected)}
          >
            Continue ({totalQty})
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
