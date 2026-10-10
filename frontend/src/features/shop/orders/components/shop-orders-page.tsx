'use client';

// EPIC-039 Fase E — back-office pesanan toko online: pipeline status,
// detail order, buat pengiriman (Biteship) / input resi manual, batalkan
// (refund manual via dashboard Xendit — keputusan owner). Tab kedua:
// moderasi ulasan produk.

import { useDeferredValue, useState } from 'react';
import { Loader2, Package, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PurchasingPageHeader } from '@/features/purchasing/components/shared/purchasing-page-header';
import { ReviewsModerationSection } from '@/features/shop/reviews';
import { PurchasingListSection } from '@/features/purchasing/components/shared/purchasing-list-section';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { useShopOrders } from '../queries';
import { courierLabel, isPickupOrder, ORDER_STATUS_TABS, orderStatusLabel, orderStatusTone } from '../status';
import { ShopOrderDetailDialog } from './shop-order-detail-dialog';

const TERMS_LABEL = { invoice: 'Invoice', pay_later: 'Bayar nanti' } as const;

/**
 * Pesanan toko online. `wholesale` menampilkan pesanan mitra B2B saja
 * (kolom mitra dan termin) tanpa judul halaman, untuk ditanam di tab.
 */
export function ShopOrdersPage({ wholesale = false }: { wholesale?: boolean }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ordersQuery = useShopOrders(statusFilter, deferredSearch, wholesale);
  const orders = ordersQuery.data ?? [];

  const list = (
      <PurchasingListSection
        icon={Package}
        title={wholesale ? 'Pesanan Mitra' : 'Daftar Pesanan'}
        description={`${orders.length} pesanan`}
        toolbar={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={wholesale ? 'Cari nomor/mitra...' : 'Cari nomor/nama/WA...'}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => ordersQuery.refetch()}
              className="h-9"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Muat Ulang
            </Button>
          </div>
        }
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUS_TABS.map((tab) => (
              <Button
                key={tab.value}
                type="button"
                size="sm"
                variant={statusFilter === tab.value ? 'default' : 'outline'}
                className="h-8"
                onClick={() => setStatusFilter(tab.value)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>

        {ordersQuery.isPending ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-gray-400">
            <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
            <p className="text-sm">Memuat pesanan...</p>
          </div>
        ) : ordersQuery.isError ? (
          <p className="px-4 py-16 text-center text-sm text-red-500">
            {ordersQuery.error.message || 'Gagal memuat pesanan'}
          </p>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-gray-400">
            <Package className="h-12 w-12 opacity-40" />
            <p className="text-sm">Belum ada pesanan</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Order</th>
                  <th className="px-4 py-3 text-left font-semibold">{wholesale ? 'Mitra' : 'Pembeli'}</th>
                  {wholesale ? <th className="px-4 py-3 text-left font-semibold">Termin</th> : null}
                  <th className="px-4 py-3 text-left font-semibold">Tujuan</th>
                  <th className="px-4 py-3 text-left font-semibold">Kurir / Resi</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedId(order.id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(order.created_at)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">
                        {order.company_name ?? order.customer_name}
                        {order.customer_id ? (
                          <span className="ml-1.5 rounded bg-pink-50 px-1.5 py-0.5 text-[10px] font-semibold text-pink-600">
                            MEMBER
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-400">{order.customer_phone}</p>
                    </td>
                    {wholesale ? (
                      <td className="px-4 py-3 text-gray-600">
                        {order.payment_terms ? TERMS_LABEL[order.payment_terms] : '—'}
                        {order.due_at ? (
                          <span className="block text-xs text-gray-400">jatuh tempo {formatDate(order.due_at)}</span>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-gray-600">{isPickupOrder(order) ? 'Ambil di cabang' : order.shipping_area_label || '—'}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700">{courierLabel(order)}</p>
                      {order.waybill ? (
                        <p className="text-xs font-medium text-indigo-600">{order.waybill}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatRupiah(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${orderStatusTone(order.status)}`}>
                        {orderStatusLabel(order.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>
  );

  return (
    <div className="space-y-6">
      {wholesale ? (
        list
      ) : (
        <>
          <PurchasingPageHeader
            title="Pesanan Toko Online"
            description="Pipeline pesanan storefront: bayar → kemas → kirim (resi) → selesai, atau bayar → siap diambil → sudah diambil. Tab Ulasan memoderasi ulasan produk dari member."
          />
          <Tabs defaultValue="orders" className="w-full flex-col">
            <TabsList>
              <TabsTrigger value="orders">Pesanan</TabsTrigger>
              <TabsTrigger value="reviews">Ulasan</TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="mt-4">{list}</TabsContent>
            <TabsContent value="reviews" className="mt-4"><ReviewsModerationSection /></TabsContent>
          </Tabs>
        </>
      )}

      {selectedId ? (
        <ShopOrderDetailDialog key={selectedId} orderId={selectedId} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
