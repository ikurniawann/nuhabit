'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TopupPackagePicker } from '@/features/wallet/components/topup-package-picker';
import type { TopupPackage } from '@/features/wallet/api';
import { formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { cn } from '@/lib/utils';

export function TopupAmountStep({
  arkRate,
  presetValues,
  minTopup,
  topupRp,
  customRp,
  creditRp,
  projectedBalance,
  packageId,
  estimatedXp,
  onSelectPackage,
  onSelectPreset,
  onCustomChange,
  onContinue,
}: {
  arkRate: number;
  presetValues: number[];
  minTopup: number;
  topupRp: number;
  customRp: string;
  creditRp: number;
  projectedBalance: number;
  packageId: string | null;
  /** null = XP top-up nonaktif atau nominal di bawah minimum. */
  estimatedXp: number | null;
  onSelectPackage: (pkg: TopupPackage) => void;
  onSelectPreset: (value: number) => void;
  onCustomChange: (raw: string) => void;
  onContinue: () => void;
}) {
  const formatArk = (value: number) => formatArkAmount(value, arkRate);
  return (
    <>
      <TopupPackagePicker selectedId={packageId} onSelect={onSelectPackage} />
      <section className="rounded-2xl border border-gray-200/70 bg-card p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top-up amount</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {presetValues.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSelectPreset(value)}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm font-semibold transition-colors',
                topupRp === value
                  ? 'border-primary/40 bg-primary/10 text-brand-text ring-1 ring-primary/30'
                  : 'border-gray-200/70 bg-white text-foreground hover:border-primary/30 hover:bg-primary/5'
              )}
            >
              <div>{formatRupiah(value)}</div>
              <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{formatArk(value)}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-1.5">
          <label htmlFor="topup-custom-amount" className="text-xs font-medium text-muted-foreground">
            Custom amount
          </label>
          <Input
            id="topup-custom-amount"
            type="text"
            inputMode="numeric"
            value={customRp}
            onChange={(event) => onCustomChange(event.target.value)}
            placeholder={`Minimum ${formatRupiah(minTopup)}`}
            className="border-gray-200/80"
          />
        </div>
      </section>

      {topupRp > 0 && (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50/80 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You will receive</span>
            <span className="font-semibold text-amber-700">{formatArk(creditRp)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Balance after top-up</span>
            <span className="font-bold text-foreground">{formatArk(projectedBalance)}</span>
          </div>
          {estimatedXp !== null && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimated XP</span>
              <span className="font-semibold text-violet-700">+{estimatedXp} XP</span>
            </div>
          )}
        </div>
      )}

      <Button
        type="button"
        onClick={onContinue}
        disabled={topupRp < minTopup}
        className="h-11 w-full bg-primary text-sm font-semibold hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground sm:w-auto sm:min-w-56"
      >
        Continue to payment
      </Button>
    </>
  );
}
