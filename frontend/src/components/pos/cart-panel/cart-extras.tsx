'use client';

import { ChevronRight, Loader2, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChargeToggleRow, SummaryRow, type MoneyFormatters } from './money';

const inputClass =
  'h-8 w-full rounded-md border border-gray-200/80 bg-white px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30';

export type CartExtrasProps = {
  money: MoneyFormatters;
  /** Diskon transaksi manual — tombol tampil bila onOpenManualDiscount ada. */
  manualDiscount: { amount: number; label: string | null; disabled: boolean } | null;
  onOpenManualDiscount: () => void;
  /** Input kode promo — null bila promo sudah terpakai atau UI promo tidak aktif. */
  promo: {
    input: string;
    busy: boolean;
    error: string | null;
    disabled: boolean;
    onInputChange?: (value: string) => void;
    onApply?: () => void;
  } | null;
  orderNotes: string;
  onOrderNotesChange?: (value: string) => void;
  tax: { label: string | null; amount: number; included: boolean; onToggle: () => void };
  service: { label: string | null; amount: number; included: boolean; onToggle?: () => void };
};

/** Opsi keranjang yang jarang dipakai (dilipat di tablet): diskon transaksi, promo, catatan, pajak & service. */
export function CartExtras({
  money,
  manualDiscount,
  onOpenManualDiscount,
  promo,
  orderNotes,
  onOrderNotesChange,
  tax,
  service,
}: CartExtrasProps) {
  return (
    <div className="space-y-2">
      {manualDiscount && (
        <button
          type="button"
          disabled={manualDiscount.disabled}
          onClick={onOpenManualDiscount}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-sm transition',
            'hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
            manualDiscount.amount > 0 ? 'text-green-700' : 'text-brand-text'
          )}
        >
          <span className="inline-flex items-center gap-1 text-left font-medium underline decoration-primary/40 underline-offset-2">
            <Percent className="h-3.5 w-3.5 shrink-0" />
            <span>
              Diskon transaksi
              {manualDiscount.amount > 0 && manualDiscount.label ? ` (${manualDiscount.label.replace(/^−/, '')})` : ''}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </span>
          <span className={cn('tabular-nums', manualDiscount.amount > 0 ? 'font-medium' : 'text-muted-foreground')}>
            {manualDiscount.amount > 0 ? `-${money.formatCurrency(manualDiscount.amount)}` : 'Atur'}
          </span>
        </button>
      )}

      {promo ? (
        <div>
          <div className="flex gap-1.5">
            <input
              type="text"
              aria-label="Kode promo"
              value={promo.input}
              onChange={(e) => promo.onInputChange?.(e.target.value)}
              placeholder={promo.disabled ? 'Promo offline' : 'Kode promo'}
              disabled={promo.disabled}
              className={cn(inputClass, 'disabled:bg-muted/40')}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2.5"
              disabled={promo.disabled || promo.busy || promo.input.trim().length < 3}
              onClick={promo.onApply}
            >
              {promo.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pakai'}
            </Button>
          </div>
          {promo.error && <p className="mt-1 text-[11px] text-red-600">{promo.error}</p>}
        </div>
      ) : null}

      {onOrderNotesChange ? (
        <input
          type="text"
          aria-label="Catatan transaksi"
          value={orderNotes}
          onChange={(e) => onOrderNotesChange(e.target.value)}
          maxLength={200}
          placeholder="Catatan transaksi — tercetak di CO & struk"
          className={inputClass}
        />
      ) : null}

      {tax.label ? (
        <ChargeToggleRow
          label={tax.label}
          checked={tax.included}
          onToggle={tax.onToggle}
          helpId="pos.tax-toggle"
          amount={tax.amount}
          money={money}
        />
      ) : tax.amount > 0 ? (
        <SummaryRow label="Tax" amount={tax.amount} money={money} />
      ) : null}

      {service.label && service.onToggle ? (
        <ChargeToggleRow
          label={service.label}
          checked={service.included}
          onToggle={service.onToggle}
          helpId="pos.service-toggle"
          amount={service.amount}
          money={money}
        />
      ) : service.amount > 0 ? (
        <SummaryRow label="Service Charge" amount={service.amount} money={money} />
      ) : null}
    </div>
  );
}
