import { useState, type FormEvent } from 'react';
import { Signature } from 'lucide-react';
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
import { updateOrderStatus } from '@/lib/pos-api';
import type { Order } from '@/lib/pos-api';
import { formatRupiah } from "@/lib/format";

/**
 * EPIC-043 — Owner Comp: open bill diselesaikan GRATIS dengan persetujuan
 * PIN supervisor (padanan digital tanda tangan owner di struk pre-settlement).
 * Server menggratiskan seluruh bill (diskon = subtotal, total & dibayar 0)
 * dan mencatat siapa penyetujunya; struk final berlabel "OWNER COMP —
 * Disetujui: <nama>".
 */
interface OwnerCompModalProps {
  open: boolean;
  order: Order | null;
  /** Keluarga checkout gabungan (CHK): nilai yang tampil & digratiskan =
   *  SELURUH anak-order (server menggratiskan sekeluarga). */
  siblings?: Order[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function OwnerCompModal({ open, order, siblings = [], onClose, onSuccess }: OwnerCompModalProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setPin('');
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
    if (!order || !pin.trim()) return;
    try {
      setBusy(true);
      setError('');
      const res = await updateOrderStatus(order.id, 'pending', {
        payment_status: 'paid',
        amount_paid: 0,
        comp_type: 'owner_comp',
        supervisor_pin: pin.trim(),
      });
      if (res.success) {
        toast.success('Bill diselesaikan sebagai Owner Comp (gratis) — penyetuju tercatat');
        reset();
        onSuccess?.();
        onClose();
      } else {
        const message = res.error || 'Gagal memproses Owner Comp';
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
            <DialogPanelTitle className="flex items-center gap-2">
              <Signature className="h-5 w-5" />
              Owner Comp — Gratiskan Bill
            </DialogPanelTitle>
            <DialogPanelDescription>
              Seluruh bill digratiskan dan tetap tercatat (nilai barang masuk laporan
              komplimen). PIN supervisor = persetujuan resmi; simpan struk yang sudah
              ditandatangani sebagai arsip fisik.
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody className="space-y-4">
            {order ? (
              <div className="rounded-xl border border-gray-200/70 bg-muted/50 p-3 text-sm">
                {(() => {
                  const family = siblings.length > 1 ? siblings : [order];
                  const gross = family.reduce(
                    (sum, o) =>
                      sum +
                      (Number((o as { subtotal?: number | string }).subtotal) ||
                        Number(o.total_amount) ||
                        0),
                    0
                  );
                  const checkoutNumber =
                    siblings.length > 1
                      ? (family[0] as { checkout_number?: string | null }).checkout_number ?? null
                      : null;
                  return (
                    <>
                      <p>
                        <span className="font-medium">Order:</span>{' '}
                        {checkoutNumber
                          ? `${checkoutNumber} (gabungan ${family.length} order)`
                          : order.order_number}
                      </p>
                      <p>
                        <span className="font-medium">Nilai bill:</span> {formatRupiah(gross)}
                      </p>
                    </>
                  );
                })()}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="comp-pin" className="text-sm font-medium text-foreground">
                PIN supervisor
              </label>
              <Input
                id="comp-pin"
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
              <div className="rounded-lg border border-red-200/80 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </DialogPanelBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
              Batal
            </Button>
            <Button type="submit" disabled={busy || !pin.trim()}>
              {busy ? 'Memproses...' : 'Gratiskan (Owner Comp)'}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
