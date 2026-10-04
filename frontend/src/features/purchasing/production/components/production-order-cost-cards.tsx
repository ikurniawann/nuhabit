"use client";

import { Box } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatNumber } from "@/lib/format";
import { optionsLabel } from "@/lib/purchasing/production-ui-display";
import type { ProductionDetail } from "../types";

function QtyWithUnit({ value, unit }: { value: number | string; unit?: string | null }) {
  return (
    <p className="mt-2 text-xl font-semibold text-gray-950">
      {formatNumber(value, 3)}
      {unit ? <span className="ml-1.5 text-sm font-medium text-gray-500">{unit}</span> : null}
    </p>
  );
}

/** Empat kartu ringkasan: qty rencana, qty aktual, biaya bahan, HPP per unit. */
export function ProductionOrderStats({ order, materialCost }: { order: ProductionDetail; materialCost: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-4">
          <p className="text-xs font-medium text-gray-500">Kuantitas Rencana</p>
          <QtyWithUnit value={order.planned_qty} unit={order.output_satuan_nama} />
        </CardContent>
      </Card>
      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-4">
          <p className="text-xs font-medium text-gray-500">Kuantitas Aktual</p>
          <QtyWithUnit value={order.actual_qty} unit={order.output_satuan_nama} />
        </CardContent>
      </Card>
      <Card className="border-pink-200/70 bg-pink-50/40 shadow-xs">
        <CardContent className="p-4">
          <p className="text-xs font-medium text-pink-700">Biaya Bahan</p>
          <p className="mt-2 text-xl font-semibold text-pink-800">{formatNumber(materialCost)}</p>
        </CardContent>
      </Card>
      <Card className="border-emerald-200/70 bg-emerald-50/40 shadow-xs">
        <CardContent className="p-4">
          <p className="text-xs font-medium text-emerald-700">HPP / Unit</p>
          <p className="mt-2 text-xl font-semibold text-emerald-800">{formatNumber(order.hpp_per_unit)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Rincian biaya order dan daftar batch output (beserta rincian per varian). */
export function ProductionOrderCostAndBatches({
  order,
  materialCost,
}: {
  order: ProductionDetail;
  materialCost: number;
}) {
  const costRows = [
    ["Bahan", materialCost],
    ["Overhead", order.overhead_cost],
    ["Tenaga Kerja", order.labor_cost],
    ["Kemasan", order.packaging_cost],
    ["Susut", order.waste_cost],
  ] as const;
  const unit = order.output_satuan_nama ? ` ${order.output_satuan_nama}` : "";

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <Card className="border-gray-200/70 shadow-xs xl:col-span-5">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Rincian Biaya</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 text-sm">
          {costRows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium">{formatNumber(value)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-gray-200/70 shadow-xs xl:col-span-7">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Box className="h-4 w-4 text-pink-600" />
            Output Batch
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {order.batches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200/80 px-4 py-6 text-center text-sm text-gray-500">
              Batch muncul setelah output produksi diterima.
            </div>
          ) : (
            order.batches.map((batch) => (
              <div key={batch.id} className="rounded-lg border border-gray-200/70 bg-gray-50/80 px-4 py-3 text-sm">
                <p className="font-semibold text-gray-950">{batch.batch_number}</p>
                <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-gray-500">
                  <span>
                    Qty {formatNumber(batch.qty_produced, 3)}
                    {unit}
                  </span>
                  <span>{formatNumber(batch.hpp_per_unit)}/satuan</span>
                  <span>{formatDate(batch.created_at)}</span>
                </div>
                {batch.variant_outputs && batch.variant_outputs.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-gray-200/70 pt-3">
                    <p className="text-xs font-semibold text-gray-600">Rincian per varian</p>
                    {batch.variant_outputs.map((variant) => {
                      const options = optionsLabel(variant.options);
                      return (
                        <div
                          key={variant.pos_sku_id}
                          className="flex items-center justify-between gap-3 text-xs text-gray-600"
                        >
                          <span>
                            {variant.sku || variant.pos_sku_id}
                            {options ? ` — ${options}` : ""}
                          </span>
                          <span className="font-semibold text-gray-900">{formatNumber(variant.qty, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
