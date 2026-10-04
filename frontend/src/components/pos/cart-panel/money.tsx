'use client';

import { Check } from 'lucide-react';
import { HelpHint } from '@/components/ui/help-hint';
import { cn } from '@/lib/utils';

export type MoneyFormatters = {
  formatCurrency: (value: number) => string;
  /** Kosong = baris ARK tidak ditampilkan (fitur ARK Coin nonaktif). */
  formatArk?: (value: number) => string;
};

export function MoneyPair({
  amount,
  formatCurrency,
  formatArk,
  className,
  arkClassName,
}: MoneyFormatters & { amount: number; className?: string; arkClassName?: string }) {
  return (
    <div className={cn('text-right leading-tight', className)}>
      <div className="font-medium text-foreground">{formatCurrency(amount)}</div>
      {formatArk && <div className={cn('text-[11px] font-medium text-amber-600/90', arkClassName)}>{formatArk(amount)}</div>}
    </div>
  );
}

/** Baris ringkasan: label kiri, nominal kanan. */
export function SummaryRow({ label, amount, money }: { label: string; amount: number; money: MoneyFormatters }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <MoneyPair amount={amount} {...money} />
    </div>
  );
}

/** Baris potongan hijau "-Rp…". */
export function DiscountRow({ label, amount, formatCurrency }: { label: string; amount: number; formatCurrency: (value: number) => string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="truncate text-green-700">{label}</span>
      <span className="font-medium tabular-nums text-green-700">-{formatCurrency(amount)}</span>
    </div>
  );
}

/** Pajak/service opsional: centang untuk menyertakan, nominal di kanan. */
export function ChargeToggleRow({
  label,
  checked,
  onToggle,
  helpId,
  amount,
  money,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  helpId: string;
  amount: number;
  money: MoneyFormatters;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-primary bg-primary' : 'border-gray-300'}`}
          >
            {checked && <Check className="h-3 w-3 text-white" />}
          </div>
          <span>{label}</span>
        </button>
        <HelpHint helpId={helpId} role="default" />
      </div>
      <MoneyPair amount={amount} {...money} />
    </div>
  );
}
