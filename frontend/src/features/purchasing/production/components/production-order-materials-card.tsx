"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { displayName, shortagePoHref, toNumber } from "@/lib/purchasing/production-ui-display";
import type { ProductionDetail } from "../types";

export const ORDER_ACTION_BUTTON =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium shadow-sm sm:w-auto";

type ProductionOrderMaterialsCardProps = {
  order: ProductionDetail;
  shortageCount: number;
  poInsertRoute: string;
};

/** Kebutuhan bahan order: rencana, aktual, stok, kekurangan (dengan link PO), dan biaya. */
export function ProductionOrderMaterialsCard({ order, shortageCount, poInsertRoute }: ProductionOrderMaterialsCardProps) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
        <div>
          <CardTitle className="text-base">Kebutuhan Bahan</CardTitle>
          <p className="mt-1 text-xs text-gray-500">Konsumsi rencana, stok tersedia, dan nilai baris produksi.</p>
        </div>
        <Badge
          variant="outline"
          className={
            shortageCount > 0
              ? "border-red-200/80 bg-red-50 text-red-700"
              : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
          }
        >
          {shortageCount > 0 ? `${shortageCount} kekurangan` : "Stok cukup"}
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
                <th className="px-4 py-3 text-right font-semibold">Rencana</th>
                <th className="px-4 py-3 text-right font-semibold">Aktual</th>
                <th className="px-4 py-3 text-right font-semibold">Stok</th>
                <th className="px-4 py-3 text-right font-semibold">Kekurangan</th>
                <th className="px-4 py-3 text-right font-semibold">Biaya</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {order.materials.map((material) => {
                const shortage = toNumber(material.stock?.shortage_qty);
                return (
                  <tr key={material.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-950">{displayName(material.raw_material?.nama)}</p>
                      <p className="text-xs text-gray-500">{material.raw_material?.kode || material.raw_material_id}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className="border-gray-200/80 bg-gray-50 font-normal text-gray-700">
                        {material.satuan?.nama?.trim() || "-"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(material.qty_planned, 3)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(material.qty_actual, 3)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(material.stock?.qty_onhand, 3)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {shortage > 0 ? (
                        <div className="space-y-2">
                          <p className="font-semibold text-red-600">{formatNumber(shortage, 3)}</p>
                          <div className="flex justify-end">
                            <Link
                              href={shortagePoHref(poInsertRoute, order, [material])}
                              className={`${ORDER_ACTION_BUTTON} bg-red-600 text-white hover:bg-red-700`}
                            >
                              Purchase Order
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <span className="font-semibold text-emerald-600">Cukup</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-pink-700">
                      {formatNumber(material.total_cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
