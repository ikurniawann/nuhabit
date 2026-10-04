'use client';

import { History, Loader2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { cn } from '@/lib/utils';
import { isCreditEntry } from '@/lib/wallet/ledger';
import {
  canResumeQris,
  paymentMethodLabel,
  statusBadgeClass,
  statusLabel,
  walletTypeBadgeClass,
  walletTypeLabel,
} from '../topup-flow';
import type { TopupHistoryItem } from '../types';

type HistoryActions = {
  actionTopupId?: string | null;
  onShowQr: (item: TopupHistoryItem) => void;
  onCheckPayment: (item: TopupHistoryItem) => void;
  onCancel: (item: TopupHistoryItem) => void;
};

export function TopupHistoryCard({
  items,
  loading,
  errorMessage,
  arkRate,
  ...actions
}: HistoryActions & {
  items: TopupHistoryItem[];
  loading: boolean;
  errorMessage: string;
  arkRate: number;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/70 bg-card">
      <div className="flex items-center gap-2 border-b border-gray-200/70 px-4 py-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold text-foreground">Riwayat mutasi</div>
        <span className="ml-auto text-xs text-muted-foreground">{loading ? '…' : `${items.length} terakhir`}</span>
      </div>

      <div className="px-4 py-2">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat riwayat…
          </div>
        ) : errorMessage ? (
          <div className="py-4 text-sm text-red-600">{errorMessage}</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground">Belum ada mutasi wallet.</div>
        ) : (
          <div className="divide-y divide-gray-200/70">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} arkRate={arkRate} {...actions} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  item,
  arkRate,
  actionTopupId,
  onShowQr,
  onCheckPayment,
  onCancel,
}: HistoryActions & { item: TopupHistoryItem; arkRate: number }) {
  const type = String(item.type || 'topup').toLowerCase();
  const credit = isCreditEntry(type, Number(item.amount) || 0);
  const amount = Math.abs(Number(item.amount) || 0);
  const sign = credit ? '+' : '−';
  const showMethod = type === 'topup' || type === 'topup_bonus';
  const busy = actionTopupId === item.id;

  return (
    <div className="space-y-2 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', walletTypeBadgeClass(item.type))}>
            {walletTypeLabel(item.type)}
          </span>
          {type === 'topup' ? (
            <span
              className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize', statusBadgeClass(item.status))}
            >
              {statusLabel(item.status)}
            </span>
          ) : null}
        </div>
        <div className={cn('mt-1 text-sm font-semibold', credit ? 'text-emerald-700' : 'text-red-700')}>
          {sign}
          {formatRupiah(amount)}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {sign}
          {formatArkAmount(amount, arkRate)}
          {showMethod ? ` · ${paymentMethodLabel(item.payment_method)}` : null}
          {item.order_number ? ` · ${item.order_number}` : null}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(item.created_at, '—')}
          {item.balance_after != null ? ` · saldo ${formatArkAmount(Number(item.balance_after) || 0, arkRate)}` : null}
        </div>
      </div>

      {canResumeQris(item) ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-gray-200/80 text-xs"
            disabled={Boolean(actionTopupId)}
            onClick={() => onShowQr(item)}
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <QrCode className="mr-1.5 h-3.5 w-3.5" />}
            Show QR
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-emerald-200/80 text-xs text-emerald-700 hover:bg-emerald-50"
            disabled={Boolean(actionTopupId)}
            title="Sudah bayar tapi saldo belum masuk? Cek langsung ke Xendit"
            onClick={() => onCheckPayment(item)}
          >
            Cek pembayaran
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-red-200/80 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
            disabled={Boolean(actionTopupId)}
            onClick={() => onCancel(item)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
