'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QrisCard } from '@/components/pos/QrisCard';
import { formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import type { TopupCustomer } from '../types';
import { WalletCard } from './wallet-card';

export function TopupQrisStep({
  customer,
  arkRate,
  topupRp,
  creditRp,
  qrString,
  qrImageUrl,
  cancelling,
  onCancel,
  onBack,
}: {
  customer: TopupCustomer | null;
  arkRate: number;
  topupRp: number;
  creditRp: number;
  qrString?: string | null;
  qrImageUrl: string;
  /** Pembatalan sedang berjalan (tombol nonaktif). */
  cancelling: { any: boolean; thisTopup: boolean };
  onCancel: () => void;
  onBack: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
      <div className="space-y-4 lg:col-span-5">
        {customer ? <WalletCard customer={customer} arkRate={arkRate} /> : null}
        <div className="rounded-2xl border border-gray-200/70 bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting for payment</div>
          <div className="mt-1 text-3xl font-bold text-foreground">{formatRupiah(topupRp)}</div>
          <div className="mt-0.5 text-sm font-medium text-amber-600">{formatArkAmount(creditRp, arkRate)}</div>
          <p className="mt-3 text-sm text-muted-foreground">
            Ask the customer to scan this QRIS. ARK is credited after payment is confirmed.
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 lg:col-span-7">
        <QrisCard qrString={qrString} qrImageUrl={qrImageUrl} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-brand-text" />
          Waiting for payment confirmation…
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" className="border-gray-200/80" disabled={cancelling.any} onClick={onCancel}>
            {cancelling.thisTopup ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelling…
              </>
            ) : (
              'Cancel'
            )}
          </Button>
          <Button type="button" variant="outline" className="border-gray-200/80" disabled={cancelling.any} onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
