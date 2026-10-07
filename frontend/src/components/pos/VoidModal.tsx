import { useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { voidOrder } from '@/lib/pos-api';
import { isPaidPosOrder } from '@/lib/pos/void-order';
import type { Order } from '@/lib/pos-api';
import { formatRupiah } from "@/lib/format";

const VOID_REASONS = [
  { value: 'salah_pesan', label: 'Salah pesan' },
  { value: 'cancel', label: 'Customer cancel' },
  { value: 'double_order', label: 'Double order' },
  { value: 'item_habis', label: 'Item habis' },
  { value: 'lainnya', label: 'Lainnya' },
] as const;

interface VoidModalProps {
  open: boolean;
  order: Order | null;
  /** Keluarga checkout gabungan (CHK) — dialog menampilkan TOTAL gabungan.
   *  Server memang mem-void sekeluarga; dulu dialog hanya menampilkan satu
   *  anak-order sehingga nominalnya menyesatkan (laporan owner 2026-08-24). */
  siblings?: Order[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function VoidModal({ open, order, siblings = [], onClose, onSuccess }: VoidModalProps) {
  const [pin, setPin] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const paid = order ? isPaidPosOrder(order) : false;
  const family = siblings.length > 1 ? siblings : order ? [order] : [];
  const familyTotal = family.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  const checkoutNumber =
    siblings.length > 1
      ? (family[0] as { checkout_number?: string | null }).checkout_number ?? null
      : null;
  const reason =
    reasonCode === 'lainnya'
      ? customReason.trim()
      : VOID_REASONS.find((item) => item.value === reasonCode)?.label || '';

  const reset = () => {
    setPin('');
    setReasonCode('');
    setCustomReason('');
    setError('');
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!order) return;
    if (!pin.trim() || !reason) {
      setError('PIN supervisor dan alasan wajib diisi');
      return;
    }
    try {
      setBusy(true);
      setError('');
      const res = await voidOrder(order.id, reason, pin.trim());
      if (res.success) {
        toast.success(
          paid
            ? 'Transaksi di-void. ARK/gift card/tab dikembalikan otomatis; tunai & QRIS dikembalikan manual.'
            : 'Order di-void'
        );
        reset();
        onSuccess?.();
        onClose();
      } else {
        const message = res.error || 'Gagal melakukan void';
        setError(message);
        toast.error(message);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Terjadi kesalahan';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogPanel size="sm" showCloseButton={!busy}>
        <DialogPanelForm onSubmit={handleSubmit}>
          <DialogPanelHeader>
            <DialogPanelTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-5 w-5" />
              Void Order
            </DialogPanelTitle>
            <DialogPanelDescription>
              Membutuhkan PIN supervisor. Order yang sudah void tidak bisa dikembalikan.
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody className="space-y-4">
            {order ? (
              <div className="rounded-xl border border-gray-200/70 bg-muted/50 p-3 text-sm">
                <p>
                  <span className="font-medium">Order:</span>{' '}
                  {checkoutNumber
                    ? `${checkoutNumber} (gabungan ${family.length} order)`
                    : order.order_number}
                </p>
                <p>
                  <span className="font-medium">Total:</span> {formatRupiah(familyTotal)}
                </p>
                <p>
                  <span className="font-medium">Status:</span>{' '}
                  {paid ? 'Lunas' : order.status || '—'}
                </p>
              </div>
            ) : null}

            {paid ? (
              <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Transaksi ini sudah lunas. Void akan mengeluarkan order dari laporan
                dan mengembalikan ARK / gift card / tab. Tunai dan QRIS dikembalikan
                ke pelanggan di luar sistem.
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="void-reason" className="text-sm font-medium text-foreground">
                Alasan void
              </label>
              <select
                id="void-reason"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                disabled={busy}
                className="h-9 w-full rounded-lg border border-gray-200/80 bg-transparent px-3 text-sm outline-none focus-visible:border-gray-300 focus-visible:ring-1 focus-visible:ring-gray-200"
              >
                <option value="">Pilih alasan...</option>
                {VOID_REASONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {reasonCode === 'lainnya' ? (
                <textarea
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Tulis alasan lain..."
                  disabled={busy}
                  className="mt-2 w-full rounded-lg border border-gray-200/80 px-3 py-2 text-sm outline-none focus-visible:border-gray-300 focus-visible:ring-1 focus-visible:ring-gray-200"
                  rows={2}
                />
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="void-pin" className="text-sm font-medium text-foreground">
                PIN supervisor
              </label>
              <Input
                id="void-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="4-6 digit"
                disabled={busy}
                className="tracking-widest"
              />
            </div>

            {error ? (
              <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            ) : null}
          </DialogPanelBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
              Batal
            </Button>
            <Button
              type="submit"
              variant="outline"
              className="border-red-200/80 text-red-700 hover:bg-red-50"
              disabled={busy || !pin.trim() || !reason}
            >
              {busy ? 'Memproses...' : 'Void Order'}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
