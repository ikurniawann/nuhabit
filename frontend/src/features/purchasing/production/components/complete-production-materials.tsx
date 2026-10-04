"use client";

import type { Dispatch } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { toNumber } from "@/lib/purchasing/production-ui-display";
import type { CompleteFormAction, CompleteMaterialRow } from "@/lib/purchasing/production-ui-complete";

const INPUT_CLASS = "h-9 text-right text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100";

/** Tabel konsumsi bahan aktual di form terima output; baris di atas stok ditandai merah. */
export function CompleteProductionMaterials({
  materials,
  dispatch,
}: {
  materials: CompleteMaterialRow[];
  dispatch: Dispatch<CompleteFormAction>;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="border-b border-gray-200/70 pb-3">
        <CardTitle className="text-sm">Konsumsi Bahan Aktual</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Bahan</th>
              <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
              <th className="px-4 py-3 text-right font-semibold">Rencana</th>
              <th className="px-4 py-3 text-right font-semibold">Stok</th>
              <th className="px-4 py-3 text-right font-semibold">Aktual</th>
              <th className="px-4 py-3 text-right font-semibold">Susut</th>
              <th className="px-4 py-3 text-right font-semibold">Nilai</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {materials.map((material) => {
              const qtyActual = toNumber(material.qtyActual);
              const isShort = qtyActual > material.stockQty;
              return (
                <tr key={material.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{material.name}</p>
                    <p className="text-xs text-gray-500">
                      {material.code} · {formatNumber(material.unitCost)} / satuan
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant="outline" className="border-gray-200/80 bg-gray-50 font-normal text-gray-700">
                      {material.unitName || "-"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {formatNumber(material.plannedQty, 3)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${isShort ? "text-red-600" : "text-emerald-600"}`}>
                    {formatNumber(material.stockQty, 3)}
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={material.qtyActual}
                      onChange={(event) =>
                        dispatch({ type: "setMaterial", id: material.id, field: "qtyActual", value: event.target.value })
                      }
                      type="number"
                      min="0"
                      className={`${INPUT_CLASS} ${isShort ? "border-red-200/80 bg-red-50 text-red-700" : ""}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      value={material.wasteQty}
                      onChange={(event) =>
                        dispatch({ type: "setMaterial", id: material.id, field: "wasteQty", value: event.target.value })
                      }
                      type="number"
                      min="0"
                      className={INPUT_CLASS}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-pink-700">
                    {formatNumber(qtyActual * material.unitCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
