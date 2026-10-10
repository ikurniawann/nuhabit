'use client';

import { useState } from 'react';
import { Loader2, Store, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogPanel,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
  DialogPanelBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatRupiah } from '@/lib/format';
import { useShopOrderAction, useShopOrderDetail, type ShopOrderAction } from '../queries';
import { courierLabel, isPickupOrder, orderStatusLabel, orderStatusTone } from '../status';

/**
 * Detail pesanan + aksi: kemas, buat pengiriman (provider) / resi manual,
 * selesai, batalkan (refund manual via dashboard Xendit — keputusan owner).
 * Pesanan ambil di cabang: siap diambil, lalu sudah diambil.
 * Parent me-render dengan key=orderId supaya input resi ter-reset.
 */
export function ShopOrderDetailDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data: detail, error } = useShopOrderDetail(orderId);
  const action = useShopOrderAction(orderId, onClose);
  const [manualWaybill, setManualWaybill] = useState('');

  const run = (orderAction: ShopOrderAction, successMessage: string) => {
    if (!action.isPending) action.mutate({ action: orderAction, successMessage });
  };

  const submitManualWaybill = () => {
    const waybill = manualWaybill.trim();
    if (waybill.length < 6) {
      toast.error('Nomor resi minimal 6 karakter');
      return;
    }
    run({ kind: 'ship-manual', waybill }, 'Resi tersimpan — pesanan dikirim');
  };

  const cancelOrder = () => {
    if (!window.confirm('Batalkan pesanan ini? Stok akan dikembalikan. Refund uang dilakukan MANUAL via dashboard Xendit.')) return;
    run(
      { kind: 'transition', status: 'cancelled', note: 'Dibatalkan back-office — refund manual via Xendit' },
      'Pesanan dibatalkan — stok dikembalikan'
    );
  };

  const pickup = detail ? isPickupOrder(detail) : false;
  const canShip = detail ? !pickup && ['paid', 'packing'].includes(detail.status) && !detail.provider_order_id : false;
  const discount = Number(detail?.discount_amount ?? 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{detail?.order_number || 'Memuat...'}</DialogPanelTitle>
          <DialogPanelDescription>
            {detail ? `${detail.customer_name} — ${detail.customer_phone}` : ''}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="max-h-[65vh] space-y-4 overflow-y-auto">
          {error ? (
            <p className="py-10 text-center text-sm text-red-500">{error.message || 'Gagal memuat detail'}</p>
          ) : !detail ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${orderStatusTone(detail.status)}`}>
                  {orderStatusLabel(detail.status)}
                </span>
                {pickup ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                    <Store className="h-3 w-3" />
                    Ambil di cabang
                  </span>
                ) : null}
                {detail.payment_method === 'arkcoin' ? (
                  <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">ARK Coin</span>
                ) : null}
                {detail.waybill ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                    <Truck className="h-3 w-3" />
                    {detail.waybill}
                  </span>
                ) : null}
              </div>

              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm">
                <p className="font-medium text-gray-900">{detail.customer_name}</p>
                {pickup ? (
                  <p className="text-gray-600">{courierLabel(detail)}</p>
                ) : (
                  <>
                    <p className="text-gray-600">{detail.shipping_address}</p>
                    <p className="text-gray-500">
                      {detail.shipping_area_label}
                      {detail.shipping_postal_code ? ` (${detail.shipping_postal_code})` : ''}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">Kurir: {courierLabel(detail)}</p>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                {detail.items.map((item, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">
                      {item.product_name}
                      {item.sku_name ? ` — ${item.sku_name}` : ''}{' '}
                      <span className="text-gray-400">× {Number(item.quantity)}</span>
                    </span>
                    <span className="text-gray-900">{formatRupiah(item.total)}</span>
                  </div>
                ))}
                {discount > 0 ? (
                  <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
                    <span className="text-gray-500">Diskon{detail.promo_code ? ` (${detail.promo_code})` : ''}</span>
                    <span className="text-green-700">-{formatRupiah(discount)}</span>
                  </div>
                ) : null}
                <div className={`flex items-center justify-between text-sm ${discount > 0 ? '' : 'border-t border-gray-100 pt-2'}`}>
                  <span className="text-gray-500">Ongkir</span>
                  <span className="text-gray-900">{pickup ? 'Ambil sendiri' : formatRupiah(detail.shipping_cost)}</span>
                </div>
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Total</span>
                  <span className="text-pink-600">{formatRupiah(detail.total)}</span>
                </div>
              </div>

              {detail.notes ? (
                <p className="whitespace-pre-line rounded-lg bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                  {detail.notes}
                </p>
              ) : null}

              {/* Input resi manual utk order siap kirim tanpa pengiriman aktif */}
              {canShip ? (
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Input resi manual
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={manualWaybill}
                      placeholder="Nomor resi kurir"
                      onChange={(event) => setManualWaybill(event.target.value)}
                    />
                    <Button type="button" disabled={action.isPending} onClick={submitManualWaybill}>
                      Simpan
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          {detail ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              {['pending', 'paid', 'packing', 'ready_for_pickup'].includes(detail.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.isPending}
                  className="border-red-200 text-red-600 hover:bg-red-50"
                  onClick={cancelOrder}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Batalkan
                </Button>
              ) : null}
              {pickup && detail.status === 'paid' ? (
                <Button
                  type="button"
                  disabled={action.isPending}
                  className="purchasing-main-button"
                  onClick={() => run({ kind: 'transition', status: 'ready_for_pickup' }, 'Pesanan siap diambil, pembeli dikabari')}
                >
                  <Store className="mr-1.5 h-4 w-4" />
                  Tandai Siap Diambil
                </Button>
              ) : null}
              {pickup && detail.status === 'ready_for_pickup' ? (
                <Button
                  type="button"
                  disabled={action.isPending}
                  className="purchasing-main-button"
                  onClick={() => run({ kind: 'transition', status: 'picked_up' }, 'Pesanan sudah diambil')}
                >
                  Tandai Sudah Diambil
                </Button>
              ) : null}
              {!pickup && detail.status === 'paid' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => run({ kind: 'transition', status: 'packing' }, 'Pesanan ditandai dikemas')}
                >
                  Tandai Dikemas
                </Button>
              ) : null}
              {canShip ? (
                <Button
                  type="button"
                  disabled={action.isPending}
                  className="purchasing-main-button"
                  onClick={() => run({ kind: 'ship-provider' }, 'Pengiriman dibuat — menunggu resi kurir')}
                >
                  <Truck className="mr-1.5 h-4 w-4" />
                  Buat Pengiriman (Provider)
                </Button>
              ) : null}
              {detail.status === 'shipped' ? (
                <Button
                  type="button"
                  disabled={action.isPending}
                  className="purchasing-main-button"
                  onClick={() => run({ kind: 'transition', status: 'completed' }, 'Pesanan selesai')}
                >
                  Tandai Selesai
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
