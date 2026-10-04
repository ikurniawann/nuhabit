"use client";

import { formatIdrInput } from "@/components/pos/idr-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CashPanelProps {
  cashInput: string;
  change: number;
  totalAfterArk: number;
  disabled: boolean;
  formatCurrency: (v: number) => string;
  onCashChange: (value: string) => void;
}

export function CashPanel({
  cashInput,
  change,
  totalAfterArk,
  disabled,
  formatCurrency,
  onCashChange,
}: CashPanelProps) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200/70 bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">Amount received</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || totalAfterArk <= 0}
          onClick={() => onCashChange(String(Math.round(totalAfterArk)))}
          className="h-8 border-primary/20 text-brand-text hover:bg-primary/5"
        >
          Uang Pas
        </Button>
      </div>
      <Input
        type="text"
        inputMode="numeric"
        placeholder="0"
        value={formatIdrInput(cashInput)}
        onChange={(e) => onCashChange(e.target.value)}
        disabled={disabled}
        className="h-11 border-gray-200/80 bg-white text-base tabular-nums"
      />
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{change >= 0 ? "Change" : "Shortfall"}</span>
        <span
          className={cn("font-semibold", change >= 0 ? "text-emerald-600" : "text-red-600")}
        >
          {formatCurrency(Math.abs(change))}
        </span>
      </div>
    </div>
  );
}
