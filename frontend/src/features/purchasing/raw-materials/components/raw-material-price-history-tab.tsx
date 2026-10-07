"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/format";
import { useRawMaterialPriceHistory } from "../queries";

interface RawMaterialPriceHistoryTabProps {
  materialId: string;
  baseUnitName: string;
}

/** Ringkasan dan riwayat harga beli aktual (GRN/impor) per satuan dasar. */
export function RawMaterialPriceHistoryTab({ materialId, baseUnitName }: RawMaterialPriceHistoryTabProps) {
  const priceHistoryQuery = useRawMaterialPriceHistory(materialId);
  const priceSummary = priceHistoryQuery.data?.summary;
  const purchaseCosts = priceHistoryQuery.data?.purchase_costs ?? [];

  if (priceHistoryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat riwayat harga...
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Harga Beli Terakhir", value: priceSummary?.last_cost },
          { label: "Terendah", value: priceSummary?.min_cost },
          { label: "Tertinggi", value: priceSummary?.max_cost },
          { label: "Rata-rata Pembelian", value: priceSummary?.avg_cost },
        ].map((stat) => (
          <Card key={stat.label} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-gray-500">{stat.label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {stat.value && stat.value > 0 ? formatNumber(stat.value) : "-"}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">per {baseUnitName}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Riwayat Harga Pembelian</CardTitle>
          <p className="mt-1 text-sm text-gray-500">
            Harga aktual saat stok masuk dari GRN dan impor, dicatat per {baseUnitName}.
          </p>
        </CardHeader>
        <CardContent>
          {purchaseCosts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200/70 bg-white px-4 py-8 text-center">
              <p className="text-sm font-medium text-gray-700">Belum ada riwayat pembelian</p>
              <p className="mt-1 text-sm text-gray-500">
                Riwayat muncul setelah bahan baku diterima lewat GRN atau impor stok awal.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">Referensi</th>
                    <th className="px-4 py-3 text-right font-semibold">Jumlah</th>
                    <th className="px-4 py-3 text-right font-semibold">Harga Satuan</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/70">
                  {purchaseCosts.map((movement) => (
                    <tr key={movement.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(movement.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {movement.reference_number || "-"}
                        </div>
                        <div className="text-xs uppercase text-gray-500">
                          {movement.reference_type === "import" ? "Impor" : "GRN"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatNumber(movement.jumlah, 4)} {baseUnitName}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatNumber(movement.unit_cost ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatNumber(
                          movement.total_cost ??
                            Number(movement.jumlah || 0) * Number(movement.unit_cost || 0)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
