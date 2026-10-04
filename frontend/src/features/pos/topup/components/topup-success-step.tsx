'use client';

import { useState } from 'react';
import { Check, Loader2, MessageCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatRupiah } from '@/lib/format';
import { formatArkAmount } from '@/lib/pos/loyalty-settings';
import { sendTopupReceiptWa } from '../api';
import { printTopupReceipt } from '../print-topup-receipt';
import { paymentMethodLabel } from '../topup-flow';
import type { PaymentMethod, TopupCustomer, TopupResult } from '../types';
import { SummaryLine, WalletCard } from './wallet-card';

type SuccessProps = {
  customer: TopupCustomer;
  result: TopupResult;
  arkRate: number;
  topupRp: number;
  creditRp: number;
  payment: PaymentMethod;
  onNewTopup: () => void;
};

/** Langkah sukses: ringkasan, struk (cetak), kirim bukti WA, top-up lagi. */
export function TopupSuccessStep(props: SuccessProps) {
  const { customer, result, arkRate, topupRp, creditRp, onNewTopup } = props;
  const formatArk = (value: number) => formatArkAmount(value, arkRate);
  const [showReceipt, setShowReceipt] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waSentTo, setWaSentTo] = useState<string | null>(null);

  /* Top-up selalu ber-member: nomor default = nomor member; endpoint memuat data dari DB. */
  async function sendWa() {
    const topupId = result.topup_id || result.transaction?.id || null;
    if (!topupId) {
      toast.error('ID transaksi tidak ditemukan — tidak bisa kirim WA');
      return;
    }
    try {
      setWaSending(true);
      const phone = (await sendTopupReceiptWa(topupId)) ?? 'WA member';
      setWaSentTo(phone);
      toast.success(`Bukti top-up terkirim ke ${phone}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim WA');
    } finally {
      setWaSending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
      <div className="space-y-4 lg:col-span-5">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
            <Check className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Top-up successful</h2>
            <p className="text-sm text-muted-foreground">{formatArk(creditRp)} added to wallet</p>
          </div>
        </div>
        <WalletCard customer={customer} arkRate={arkRate} highlightBalance />
      </div>

      <div className="space-y-4 lg:col-span-7">
        <div className="w-full rounded-2xl border border-gray-200/70 bg-muted/40 p-4 text-left text-sm">
          <SummaryLine label="Amount paid" value={formatRupiah(topupRp)} />
          <SummaryLine label="ARK received" value={formatArk(creditRp)} />
          <SummaryLine label="Previous balance" value={formatArk(result.balance_before)} />
          <SummaryLine label="New balance" value={formatArk(result.balance_after)} strong />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-gray-200/80" onClick={() => setShowReceipt(true)}>
            Receipt
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={waSending || Boolean(waSentTo)}
            onClick={() => void sendWa()}
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          >
            {waSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {waSentTo ? `Terkirim ke ${waSentTo}` : 'Kirim WA'}
          </Button>
          <Button type="button" className="bg-primary hover:bg-primary/90" onClick={onNewTopup}>
            Top up again
          </Button>
        </div>
      </div>

      <TopupReceiptDialog {...props} open={showReceipt} onClose={() => setShowReceipt(false)} />
    </div>
  );
}

function TopupReceiptDialog({
  customer,
  result,
  arkRate,
  topupRp,
  creditRp,
  payment,
  open,
  onClose,
}: SuccessProps & { open: boolean; onClose: () => void }) {
  const formatArk = (value: number) => formatArkAmount(value, arkRate);
  const [printing, setPrinting] = useState(false);

  async function print() {
    if (printing) return;
    try {
      setPrinting(true);
      await printTopupReceipt({
        customerName: customer.name || customer.phone || 'Member',
        phone: customer.phone,
        amount: topupRp,
        arkAmountLabel: formatArk(creditRp),
        amountLabel: formatRupiah(topupRp),
        paymentMethod: payment,
        balanceBeforeLabel: formatArk(result.balance_before),
        balanceAfterLabel: formatArk(result.balance_after),
        cardId: customer.nfc_uid,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to print receipt');
    } finally {
      window.setTimeout(() => setPrinting(false), 400);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-center text-sm font-semibold">Top-up receipt</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-3 text-sm">
          <div className="border-b border-gray-200/70 pb-3 text-center">
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
              <Check className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="text-xs text-muted-foreground">Success</div>
            <div className="text-xl font-bold text-foreground">{formatArk(creditRp)}</div>
          </div>
          <SummaryLine label="Customer" value={customer.name || customer.phone || '-'} />
          <SummaryLine label="Amount" value={formatRupiah(topupRp)} />
          <SummaryLine label="Method" value={paymentMethodLabel(payment)} />
          <SummaryLine label="Previous balance" value={formatArk(result.balance_before || 0)} />
          <SummaryLine label="New balance" value={formatArk(result.balance_after || 0)} strong />
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button type="button" variant="outline" className="border-gray-200/80" onClick={onClose} disabled={printing}>
            Close
          </Button>
          <Button type="button" className="bg-primary hover:bg-primary/90" onClick={() => void print()} disabled={printing}>
            {printing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Printing…
              </>
            ) : (
              <>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
