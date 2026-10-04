"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PERIOD_PRESETS, periodRange, type OrderFilterDraft } from "../order-list-rules";

const selectClassName =
  "flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30";

const SELECTS: Array<{
  key: "payment_status" | "order_type" | "payment_method";
  id: string;
  label: string;
  options: Array<[string, string]>;
}> = [
  {
    key: "payment_status",
    id: "orders-payment-status",
    label: "Pembayaran",
    options: [["", "Semua"], ["paid", "Lunas"], ["unpaid", "Belum bayar"], ["refunded", "Refund"]],
  },
  {
    key: "order_type",
    id: "orders-type",
    label: "Tipe order",
    options: [["", "Semua"], ["dine_in", "Dine-in"], ["takeaway", "Takeaway"], ["delivery", "Delivery"]],
  },
  {
    key: "payment_method",
    id: "orders-method",
    label: "Metode bayar",
    options: [
      ["", "Semua"],
      ["cash", "Tunai"],
      ["qris", "QRIS"],
      ["credit", "Kartu"],
      ["ark_coin", "ARK Coin"],
      ["gift_card", "Gift card"],
      ["nfc_tab", "NFC Tab"],
    ],
  },
];

export function OrdersFilterCard({
  draft,
  fetching,
  onChange,
  onApply,
}: {
  draft: OrderFilterDraft;
  fetching: boolean;
  onChange: (patch: Partial<OrderFilterDraft>) => void;
  /** Terapkan draf (opsional dengan perubahan langsung, mis. preset periode). */
  onApply: (patch?: Partial<OrderFilterDraft>) => void;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {PERIOD_PRESETS.map(({ key, label }) => {
            const range = periodRange(key);
            const active = draft.date_from === range.date_from && draft.date_to === range.date_to;
            return (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                className={cn("border-gray-200/80", active && "border-primary/40 bg-primary/5 text-brand-text")}
                disabled={fetching}
                onClick={() => onApply(range)}
              >
                {label}
              </Button>
            );
          })}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="orders-date-from">Tanggal dari</Label>
            <Input
              id="orders-date-from"
              type="date"
              value={draft.date_from}
              onChange={(e) => onChange({ date_from: e.target.value })}
              className="h-10 border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orders-date-to">Tanggal sampai</Label>
            <Input
              id="orders-date-to"
              type="date"
              value={draft.date_to}
              onChange={(e) => onChange({ date_to: e.target.value })}
              className="h-10 border-border"
            />
          </div>
          {SELECTS.map((select) => (
            <div key={select.key} className="space-y-1.5">
              <Label htmlFor={select.id}>{select.label}</Label>
              <select
                id={select.id}
                value={draft[select.key]}
                onChange={(e) => onChange({ [select.key]: e.target.value })}
                className={selectClassName}
              >
                {select.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="flex items-end xl:col-start-4">
            <Button type="button" onClick={() => onApply()} disabled={fetching} className="w-full gap-2">
              {fetching ? <Loader2 className="size-4 animate-spin" /> : null}
              Terapkan filter
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
