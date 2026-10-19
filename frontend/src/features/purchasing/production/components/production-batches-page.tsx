"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { Loader2, Receipt, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { useErrorToast } from "@/features/purchasing/reports/use-error-toast";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { getProductionModuleConfig } from "../production-module";
import { useProductionBatches } from "../queries";

/** Biaya Batch: HPP, pecahan biaya dan yield setiap batch hasil produksi. */
export function ProductionBatchesPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const config = getProductionModuleConfig(moduleType);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const batchesQuery = useProductionBatches(moduleType, deferredSearch);
  useErrorToast(batchesQuery.error, "Gagal memuat biaya batch");
  const batches = batchesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Biaya Batch"
        description="HPP setiap batch hasil produksi: biaya bahan, biaya konversi, scrap dan yield."
      />

      <PurchasingListSection
        icon={Receipt}
        title="Batch Produksi"
        description="100 batch terbaru."
        toolbar={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              aria-label="Cari batch"
              placeholder="Cari batch, order atau item"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 pl-9 text-sm"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Batch</th>
                <th className="px-4 py-3 text-right font-semibold">Baik / Scrap</th>
                <th className="px-4 py-3 text-right font-semibold">Yield</th>
                <th className="px-4 py-3 text-right font-semibold">Bahan</th>
                <th className="px-4 py-3 text-right font-semibold">Konversi</th>
                <th className="px-4 py-3 text-right font-semibold">HPP / Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batchesQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                    Memuat batch...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    Belum ada batch hasil produksi.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={config.productionBatchRoute(batch.id)} className="font-medium text-pink-700 hover:underline">
                        {batch.batch_number}
                      </Link>
                      {batch.is_final && (
                        <Badge variant="outline" className="ml-2 border-emerald-200/80 bg-emerald-50 text-emerald-700">
                          Terakhir
                        </Badge>
                      )}
                      <p className="text-xs text-gray-500">
                        {batch.item_nama} · {formatDate(batch.created_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatNumber(batch.qty_good, 3)} / {formatNumber(batch.qty_scrap, 3)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {batch.yield_pct === null ? "-" : `${formatNumber(batch.yield_pct, 2)}%`}
                    </td>
                    <td className="px-4 py-3 text-right">{batch.stepped ? formatRupiah(batch.material_cost) : "-"}</td>
                    <td className="px-4 py-3 text-right">{batch.stepped ? formatRupiah(batch.conversion_cost) : "-"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      {formatRupiah(batch.hpp_per_unit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PurchasingListSection>
    </div>
  );
}
