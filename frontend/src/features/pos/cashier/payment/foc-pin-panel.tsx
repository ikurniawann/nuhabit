"use client";

import { Input } from "@/components/ui/input";

import type { PaymentCustomer } from "./payment-state";

interface FocPinPanelProps {
  customer: PaymentCustomer | null;
  pin: string;
  disabled: boolean;
  onPinChange: (value: string) => void;
}

/**
 * Metode FOC terdeteksi dari kode/nama katalog: tagihan digratiskan, jadi
 * input tunai disembunyikan dan konfirmasi digerbang PIN supervisor.
 */
export function FocPinPanel({ customer, pin, disabled, onPinChange }: FocPinPanelProps) {
  if (!customer) {
    return (
      <div className="rounded-xl border border-red-200/80 bg-red-50/70 p-4 text-sm text-red-700">
        Metode FOC membutuhkan customer/member — pilih customer dulu
        sebelum melanjutkan.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">PIN Supervisor</label>
        <span className="max-w-[50%] truncate text-xs text-muted-foreground">
          Customer: {customer.name || "Member"}
        </span>
      </div>
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="••••"
        value={pin}
        onChange={(e) => onPinChange(e.target.value)}
        disabled={disabled}
        className="h-11 border-amber-200/80 bg-white text-base tracking-widest"
      />
      <p className="text-xs leading-snug text-muted-foreground">
        Metode FOC (Free of Charge) membutuhkan persetujuan supervisor —
        nama penyetuju tercatat di transaksi.
      </p>
    </div>
  );
}
