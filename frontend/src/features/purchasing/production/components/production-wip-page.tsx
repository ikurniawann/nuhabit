"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { Layers, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { getProductionModuleConfig } from "../production-module";
import { useProductionWip } from "../queries";
import { ScrollRegion } from "@/components/ui/scroll-region";

/** WIP Produksi: order berjalan dengan nilai bahan yang masih di proses. */
export function ProductionWipPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const config = getProductionModuleConfig(moduleType);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const wipQuery = useProductionWip(moduleType, deferredSearch);
  useErrorToast(wipQuery.error, "Gagal memuat WIP produksi");
  const orders = wipQuery.data?.orders ?? [];
  const summary = wipQuery.data?.summary;

  const stats = [
    { label: "Order berjalan", value: formatNumber(summary?.orders) },
    { label: "Saldo WIP", value: formatRupiah(summary?.wip_value) },
    { label: "Total bahan dikeluarkan", value: formatRupiah(summary?.issued_cost) },
  ];

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="WIP Produksi"
        description="Nilai bahan yang sudah dikeluarkan ke produksi dan belum menjadi hasil atau scrap."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <PurchasingListSection
        icon={Layers}
        title="Order dengan WIP"
        description="Order IN_PROGRESS yang bahannya sudah dikeluarkan."
        toolbar={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              aria-label="Cari order"
              placeholder="Cari nomor atau item"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 pl-9 text-sm"
            />
          </div>
        }
      >
        <ScrollRegion label="Tabel WIP per order" className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Order</th>
                <th className="px-4 py-3 text-right font-semibold">Dikeluarkan</th>
                <th className="px-4 py-3 text-right font-semibold">Masuk Stok</th>
                <th className="px-4 py-3 text-right font-semibold">Saldo WIP</th>
                <th className="px-4 py-3 text-right font-semibold">Hasil</th>
                <th className="px-4 py-3 text-left font-semibold">Terakhir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {wipQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                    Memuat WIP...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Tidak ada WIP. Keluarkan bahan dari halaman detail order produksi untuk memulai.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={config.productionOrderRoute(order.id)} className="font-medium text-pink-700 hover:underline">
                        {order.nomor_produksi}
                      </Link>
                      <p className="text-xs text-gray-500">
                        {order.item_nama} · rencana {formatNumber(order.planned_qty, 3)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">{formatRupiah(order.issued_cost)}</td>
                    <td className="px-4 py-3 text-right">{formatRupiah(order.received_material_cost)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-pink-700">{formatRupiah(order.wip_value)}</td>
                    <td className="px-4 py-3 text-right">
                      <p>
                        {formatNumber(order.qty_good, 3)} baik / {formatNumber(order.qty_scrap, 3)} scrap
                      </p>
                      <p className="text-xs text-gray-500">{order.batches} batch</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      Keluar {formatDate(order.last_issue_at)}
                      {order.last_receipt_at ? ` · Terima ${formatDate(order.last_receipt_at)}` : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollRegion>
      </PurchasingListSection>
    </div>
  );
}
