'use client';

import { Banknote, Check, Gift, Loader2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { cn } from '@/lib/utils';
import type { PaymentMethod } from '../types';

const METHODS = [
  { id: 'qris' as const, icon: QrCode, label: 'QRIS', desc: 'Scan QRIS — ARK credited after payment' },
  { id: 'cash' as const, icon: Banknote, label: 'Cash', desc: 'Cash at cashier — ARK credited instantly' },
  { id: 'foc' as const, icon: Gift, label: 'FOC (Gratis)', desc: 'Marketing — butuh PIN supervisor, tanpa XP' },
];

export function TopupPaymentStep({
  arkRate,
  topupRp,
  creditRp,
  payment,
  focPin,
  submitting,
  onPaymentChange,
  onFocPinChange,
  onSubmit,
}: {
  arkRate: number;
  topupRp: number;
  creditRp: number;
  payment: PaymentMethod;
  focPin: string;
  submitting: boolean;
  onPaymentChange: (payment: PaymentMethod) => void;
  onFocPinChange: (pin: string) => void;
  onSubmit: () => void;
}) {
  const amount = formatRupiah(topupRp);
  return (
    <>
      <div className="rounded-2xl border border-gray-200/70 bg-card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top-up amount</div>
        <div className="mt-1 text-3xl font-bold text-foreground">{amount}</div>
        <div className="mt-0.5 text-sm font-medium text-amber-600">{formatArkAmount(creditRp, arkRate)}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {METHODS.map((method) => (
          <button
            key={method.id}
            type="button"
            onClick={() => onPaymentChange(method.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
              payment === method.id
                ? 'border-primary/40 bg-primary/10 ring-1 ring-primary/30'
                : 'border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5'
            )}
          >
            <method.icon className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{method.label}</div>
              <div className="text-xs text-muted-foreground">{method.desc}</div>
            </div>
            {payment === method.id ? <Check className="h-4 w-4 text-brand-text" /> : null}
          </button>
        ))}
      </div>

      {payment === 'foc' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label htmlFor="foc-pin" className="text-sm font-semibold text-amber-900">
            PIN Supervisor
          </label>
          <p className="mb-2 text-xs text-amber-800">
            Topup FOC memberi saldo ARK <strong>gratis</strong> untuk kebutuhan marketing: tidak ada uang masuk, tidak
            menghasilkan XP, dan otomatis dikabarkan ke owner.
          </p>
          <Input
            id="foc-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={focPin}
            onChange={(e) => onFocPinChange(e.target.value)}
            placeholder="Masukkan PIN supervisor"
            className="h-11 max-w-xs bg-white"
          />
        </div>
      ) : null}

      <Button
        type="button"
        onClick={onSubmit}
        disabled={submitting || (payment === 'foc' && !focPin.trim())}
        className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 sm:w-auto sm:min-w-56"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing…
          </>
        ) : payment === 'cash' ? (
          `Confirm cash ${amount}`
        ) : payment === 'foc' ? (
          `Confirm FOC ${amount} (gratis)`
        ) : (
          `Show QRIS ${amount}`
        )}
      </Button>
    </>
  );
}
