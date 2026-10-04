"use client";

import { Wifi } from "lucide-react";

import { Input } from "@/components/ui/input";

import type { PaymentState } from "./payment-state";

interface NfcTabPanelProps {
  input: string;
  checking: boolean;
  result: PaymentState["nfcResult"];
  total: number;
  disabled: boolean;
  formatCurrency: (v: number) => string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
}

export function NfcTabPanel({
  input,
  checking,
  result,
  total,
  disabled,
  formatCurrency,
  onInputChange,
  onSubmit,
}: NfcTabPanelProps) {
  return (
    <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-sky-800">
        <Wifi className="h-4 w-4" />
        Tap gelang pengunjung
      </div>
      <Input
        autoFocus
        placeholder="Fokuskan kursor lalu tap gelang di reader"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={disabled || checking}
        className="h-11 border-sky-200/80 bg-white font-mono text-sm"
      />
      {checking && <p className="text-xs text-sky-700/80">Memeriksa gelang…</p>}
      {result && !checking && (
        result.ok ? (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-emerald-700">
              {result.contactName}
              <span className="ml-2 text-xs font-normal text-emerald-600">
                {result.paymentMode === "prepaid" ? "Prepaid" : "Postpaid"}
              </span>
            </p>
            {result.available !== null && result.available !== undefined && (
              <p className="text-xs text-muted-foreground">
                {result.paymentMode === "prepaid"
                  ? "Saldo tersisa setelah order"
                  : "Sisa plafon setelah order"}
                : {formatCurrency(Math.max(0, result.available - total))}
              </p>
            )}
            <p className="text-xs text-emerald-600">
              Tagihan pindah ke tab — dibayar saat keluar / dipotong saldo
            </p>
          </div>
        ) : (
          <p className="text-sm font-medium text-red-600">
            {result.reason || "Gelang tidak bisa dipakai"}
          </p>
        )
      )}
    </div>
  );
}
