"use client";

import { Gift } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { PaymentState } from "./payment-state";

interface GiftCardPanelProps {
  input: string;
  checking: boolean;
  result: PaymentState["giftResult"];
  total: number;
  disabled: boolean;
  formatCurrency: (v: number) => string;
  onInputChange: (value: string) => void;
  onCheck: () => void;
}

export function GiftCardPanel({
  input,
  checking,
  result,
  total,
  disabled,
  formatCurrency,
  onInputChange,
  onCheck,
}: GiftCardPanelProps) {
  const balance = result?.balance ?? 0;
  return (
    <div className="space-y-3 rounded-xl border border-violet-200/80 bg-violet-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
        <Gift className="h-4 w-4" />
        Masukkan kode gift card
      </div>
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder="Contoh: ABCD2345EFGH"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCheck();
            }
          }}
          disabled={disabled || checking}
          className="h-11 border-violet-200/80 bg-white font-mono text-sm tracking-wider"
        />
        <Button
          type="button"
          variant="outline"
          onClick={onCheck}
          disabled={disabled || checking || !input.trim()}
          className="h-11 border-violet-200/80"
        >
          Cek
        </Button>
      </div>
      {checking && <p className="text-xs text-violet-700/80">Memeriksa kartu…</p>}
      {result && !checking && (
        result.ok ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saldo kartu</span>
              <span className="font-semibold text-violet-700">{formatCurrency(balance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total tagihan</span>
              <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
            </div>
            {result.covers ? (
              <p className="text-sm font-medium text-emerald-600">
                Saldo menutup seluruh tagihan — sisa{" "}
                {formatCurrency(Math.max(0, balance - total))}
              </p>
            ) : (
              <p className="text-sm font-medium text-red-600">
                Saldo kurang {formatCurrency(total - balance)} —
                gift card harus menutup seluruh tagihan, minta metode lain
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm font-medium text-red-600">
            {result.reason || "Gift card tidak bisa dipakai"}
          </p>
        )
      )}
    </div>
  );
}
