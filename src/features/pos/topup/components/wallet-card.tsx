'use client';

import { Coins } from 'lucide-react';
import { formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import type { TopupCustomer } from '../types';

export function WalletCard({
  customer,
  arkRate,
  highlightBalance = false,
  projectedBalance,
}: {
  customer: TopupCustomer;
  arkRate: number;
  highlightBalance?: boolean;
  projectedBalance?: number;
}) {
  const balance = Number(customer.ark_coin_balance || 0);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary to-amber-600 p-5 text-primary-foreground shadow-sm">
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-10 left-10 h-28 w-28 rounded-full bg-black/10" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-90">
            <Coins className="h-3.5 w-3.5" />
            ARK Wallet
          </div>
          <div className="mt-2 truncate text-lg font-bold">{customer.name || 'Unnamed member'}</div>
          <div className="mt-0.5 text-sm opacity-90">{customer.phone}</div>
        </div>
        <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold capitalize text-white">
          {customer.membership_tier || 'regular'}
        </span>
      </div>

      {customer.nfc_uid ? (
        <div className="relative mt-3 text-xs font-mono tracking-wide opacity-90">Card {customer.nfc_uid}</div>
      ) : null}

      <div className="relative mt-6">
        <div className="text-xs uppercase tracking-wide opacity-80">
          {highlightBalance ? 'Remaining balance' : 'Balance'}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-tight">{formatArkAmount(balance, arkRate)}</div>
        <div className="mt-0.5 text-sm opacity-90">{formatRupiah(balance)}</div>
      </div>

      {typeof projectedBalance === 'number' && projectedBalance !== balance ? (
        <div className="relative mt-4 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-90">After top-up</span>
            <span className="font-bold">{formatArkAmount(projectedBalance, arkRate)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Baris label–nilai pada ringkasan & struk top-up. */
export function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between last:mb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-bold text-amber-600' : 'font-medium text-foreground'}>{value}</span>
    </div>
  );
}
