'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatRupiah } from '@/lib/format';
import { GIFT_CARD_RELOAD_PAYMENT_METHODS } from '@/lib/giftcard/reload-payment-methods';
import { reloadGiftCardByCode } from '../api';

/** Isi ulang saldo gift card di kasir: scanner QR kartu cukup "mengetik" kode ke kolom kode. */
export function GiftCardReloadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');

  const close = () => {
    setCode('');
    setAmount('');
    setReference('');
    onClose();
  };
  const reload = useMutation({
    mutationFn: reloadGiftCardByCode,
    onSuccess: ({ balanceAfter }) => {
      toast.success(`Gift card ${code.trim().toUpperCase()} terisi. Saldo kini ${formatRupiah(balanceAfter)}`);
      void queryClient.invalidateQueries({ queryKey: ['giftcard'] });
      close();
    },
    onError: (error) => toast.error(error.message),
  });

  const amountNum = Number(amount);
  const valid = code.trim().length >= 3 && Number.isInteger(amountNum) && amountNum > 0;
  const submit = () =>
    valid &&
    !reload.isPending &&
    reload.mutate({
      code: code.trim(),
      amount: amountNum,
      payment_method: method,
      payment_reference: reference.trim() || null,
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !reload.isPending && close()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Isi ulang gift card</DialogPanelTitle>
          <DialogPanelDescription>Scan QR kartu atau ketik kodenya. Pembayaran tercatat di riwayat kartu.</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pos-gc-reload-code">Kode gift card</Label>
            <Input
              id="pos-gc-reload-code"
              autoFocus
              autoComplete="off"
              className="font-mono uppercase"
              maxLength={40}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-gc-reload-amount">Nominal (Rp)</Label>
            <Input
              id="pos-gc-reload-amount"
              inputMode="numeric"
              placeholder="100000"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-gc-reload-method">Metode bayar</Label>
            <Select value={method} onValueChange={(value) => value && setMethod(value)}>
              <SelectTrigger id="pos-gc-reload-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(GIFT_CARD_RELOAD_PAYMENT_METHODS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-gc-reload-ref">Referensi pembayaran (opsional)</Label>
            <Input
              id="pos-gc-reload-ref"
              placeholder="No. struk EDC / transfer"
              maxLength={80}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={reload.isPending}>
            Batal
          </Button>
          <Button onClick={submit} disabled={!valid || reload.isPending}>
            {reload.isPending ? 'Menyimpan…' : valid ? `Isi ${formatRupiah(amountNum)}` : 'Isi ulang'}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
