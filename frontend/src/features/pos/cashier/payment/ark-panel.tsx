"use client";

import { Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { PaymentCustomer } from "./payment-state";

interface ArkPanelProps {
  customer: PaymentCustomer | null;
  total: number;
  disabled: boolean;
  formatArk: (v: number) => string;
  onTapNFC: () => void;
}

export function ArkPanel({ customer, total, disabled, formatArk, onTapNFC }: ArkPanelProps) {
  if (!customer) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50 p-4 text-center">
        <Wifi className="mx-auto h-8 w-8 text-amber-500" />
        <div className="text-sm font-semibold text-amber-800">No member selected</div>
        <p className="text-xs text-amber-700/80">
          Tap an NFC card or select a member to pay with ARK Coin.
        </p>
        <Button
          type="button"
          onClick={onTapNFC}
          disabled={disabled}
          className="w-full bg-amber-500 text-white hover:bg-amber-600"
        >
          Tap NFC card
        </Button>
      </div>
    );
  }

  const covers = customer.ark_coin_balance >= total;
  return (
    <div className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50 p-4">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">ARK balance</span>
        <span className="font-semibold text-amber-700">
          {formatArk(customer.ark_coin_balance)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Bill total</span>
        <span className="font-semibold text-foreground">{formatArk(total)}</span>
      </div>
      <p className={cn("text-sm font-medium", covers ? "text-emerald-600" : "text-red-600")}>
        {covers
          ? "Balance covers the full amount"
          : `Short by ${formatArk(total - customer.ark_coin_balance)}`}
      </p>
    </div>
  );
}
