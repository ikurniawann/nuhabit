"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { getProductionModuleConfig } from "../production-module";
import { useProductionBatch } from "../queries";
import { ScrollRegion } from "@/components/ui/scroll-region";

function pct(value: number | null) {
  return value === null ? "-" : `${formatNumber(value, 2)}%`;
}

/** Rincian biaya satu batch: pecahan biaya, porsi tiap bahan, yield, varian. */
export function ProductionBatchDetailPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const config = getProductionModuleConfig(moduleType);
  const batchId = useParams<{ id: string }>().id;
  const batchQuery = useProductionBatch(batchId);
  useErrorToast(batchQuery.error, "Gagal memuat batch produksi");
  const batch = batchQuery.data;

  if (batchQuery.isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat batch produksi...
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="space-y-4">
        <PurchasingFormHeader backHref={config.productionBatchesRoute} title="Batch Produksi" />
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          Batch produksi tidak ditemukan
        </div>
      </div>
    );
  }

  const costRows = [
    ["Biaya bahan", batch.material_cost],
    ["Biaya konversi", batch.conversion_cost],
    ["Total ke stok", batch.total_cost],
    ["WIP dibebankan sebagai scrap", batch.scrap_cost],
    ["Kerugian scrap di atas toleransi", batch.abnormal_scrap_cost],
  ] as const;
  const yieldRows = [
    ["Hasil baik", formatNumber(batch.qty_good, 3)],
    ["Scrap", formatNumber(batch.qty_scrap, 3)],
    [
      batch.scrap_tolerance_pct === null
        ? "Scrap normal"
        : `Scrap normal (toleransi ${formatNumber(batch.scrap_tolerance_pct, 2)}%)`,
      formatNumber(batch.qty_scrap_normal, 3),
    ],
    ["Scrap di atas toleransi", formatNumber(batch.qty_scrap_abnormal, 3)],
    ["Yield batch", pct(batch.yield_pct)],
    ["Terhadap rencana order", `${pct(batch.planned_yield_pct)} dari ${formatNumber(batch.planned_qty, 3)}`],
  ] as const;

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={config.productionBatchesRoute}
        title={batch.batch_number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={config.productionOrderRoute(batch.production_order_id)} className="text-pink-700 hover:underline">
              {batch.nomor_produksi}
            </Link>
            <span className="text-gray-300">·</span>
            <span>{batch.item_nama}</span>
            <span className="text-gray-300">·</span>
            <span>{formatDate(batch.created_at)}</span>
            {batch.is_final && (
              <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50 text-emerald-700">
                Batch terakhir
              </Badge>
            )}
          </span>
        }
      />

      {!batch.stepped && (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Batch ini berasal dari Terima Output sekali jalan, jadi biayanya tidak dipecah per bahan.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-200/70 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-emerald-700">HPP / Unit</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-800">{formatRupiah(batch.hpp_per_unit)}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-gray-500">Yield</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{pct(batch.yield_pct)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Rincian Biaya</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            {costRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium">{formatRupiah(value)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Hasil & Yield</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 text-sm">
            {yieldRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {batch.stepped && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Porsi Biaya Bahan</CardTitle>
            <p className="text-xs text-gray-500">
              Biaya bahan batch, termasuk yang dibebankan sebagai scrap, dibagi menurut nilai bahan yang dikeluarkan ke order.
            </p>
          </CardHeader>
          <CardContent className="p-4">
            <ScrollRegion label="Tabel porsi biaya bahan" className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 text-left font-semibold">Bahan</th>
                    <th className="py-2 text-right font-semibold">Dikeluarkan</th>
                    <th className="py-2 text-right font-semibold">Nilai Keluar</th>
                    <th className="py-2 text-right font-semibold">Porsi</th>
                    <th className="py-2 text-right font-semibold">Biaya di Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batch.materials.map((m) => (
                    <tr key={m.raw_material_id}>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-gray-900">{m.nama}</p>
                        <p className="text-xs text-gray-500">{m.kode}</p>
                      </td>
                      <td className="py-2 text-right">
                        {formatNumber(m.issued_qty, 4)} {m.satuan}
                      </td>
                      <td className="py-2 text-right">{formatRupiah(m.issued_cost)}</td>
                      <td className="py-2 text-right">{formatNumber(m.share_pct, 2)}%</td>
                      <td className="py-2 text-right font-medium">{formatRupiah(m.share_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </CardContent>
        </Card>
      )}

      {batch.variants.length > 0 && (
        <Card className="border-gray-200/70 shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Rincian per Varian</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4 text-sm">
            {batch.variants.map((v) => (
              <div key={v.pos_sku_id} className="flex justify-between gap-3">
                <span className="text-gray-700">
                  {v.sku || v.pos_sku_id} {v.name ? `· ${v.name}` : ""}
                </span>
                <span className="font-medium">{formatNumber(v.qty, 2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
