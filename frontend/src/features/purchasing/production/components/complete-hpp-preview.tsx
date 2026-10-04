"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import type { CompletePreview } from "@/lib/purchasing/production-ui-complete";

/** Pratinjau HPP form terima output plus peringatan output nol dan stok kurang. */
export function CompleteHppPreview({ preview, outputUnit }: { preview: CompletePreview; outputUnit?: string | null }) {
  const costRows = [
    ["Bahan", preview.materialCost],
    ["Overhead", preview.overheadCost],
    ["Tenaga Kerja", preview.laborCost],
    ["Kemasan", preview.packagingCost],
    ["Susut", preview.wasteCost],
  ] as const;

  return (
    <div className="space-y-4">
      <Card className="border-pink-200/70 bg-pink-50/40 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-pink-900">Pratinjau HPP</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-pink-700">Output</span>
            <span className="font-semibold text-pink-950">
              {formatNumber(preview.actualQty, 3)}
              {outputUnit ? ` ${outputUnit}` : ""}
            </span>
          </div>
          {costRows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <span className="text-pink-700">{label}</span>
              <span className="font-semibold text-pink-950">{formatNumber(value)}</span>
            </div>
          ))}
          <div className="border-t border-pink-200/70 pt-3">
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-pink-800">Total Biaya</span>
              <span className="font-bold text-pink-950">{formatNumber(preview.totalCost)}</span>
            </div>
            <div className="mt-3 rounded-lg bg-white px-3 py-3">
              <p className="text-xs font-medium text-pink-600">HPP / Unit</p>
              <p className="mt-1 text-2xl font-semibold text-pink-900">{formatNumber(preview.hppPerUnit)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {preview.actualQty <= 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
          Output aktual harus lebih dari 0 sebelum menerima output produksi.
        </div>
      )}

      {preview.shortageItems.length > 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-800">Stok tidak cukup</h3>
          <p className="mt-1 text-sm text-red-700">Kurangi konsumsi aktual atau terima barang masuk terlebih dahulu.</p>
          <div className="mt-3 space-y-2">
            {preview.shortageItems.map((material) => (
              <div key={material.id} className="rounded-lg bg-white px-3 py-2 text-xs text-red-700">
                <span className="font-semibold">{material.name}</span>: butuh {formatNumber(material.qtyActual, 3)},
                stok {formatNumber(material.stockQty, 3)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
