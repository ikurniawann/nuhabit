"use client";

import Link from "next/link";
import { Beaker, Loader2, Pencil, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { displayName } from "@/lib/purchasing/production-ui-display";
import { bomLineRequirement } from "@/lib/purchasing/production-ui-order-form";
import type { CogsMaterial } from "../types";

type ProductionBomPreviewProps = {
  isProduct: boolean;
  materials: CogsMaterial[];
  plannedQty: number;
  materialCost: number;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  bomEditorHref: string;
};

/** Tabel resep (BOM) di form order baru: kebutuhan, stok, dan biaya per bahan untuk qty rencana. */
export function ProductionBomPreview({
  isProduct,
  materials,
  plannedQty,
  materialCost,
  loading,
  failed,
  onRetry,
  bomEditorHref,
}: ProductionBomPreviewProps) {
  const hasLines = materials.length > 0;

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Beaker className="h-4 w-4 text-pink-600" />
            Resep (BOM)
          </CardTitle>
          <p className="mt-1 text-xs text-gray-500">
            Komponen yang dibutuhkan untuk {formatNumber(plannedQty, 3)} unit
            {hasLines ? ` · ${materials.length} bahan` : ""}
          </p>
        </div>
        <Link href={bomEditorHref}>
          <Button type="button" variant="outline" size="sm" className="h-9 border-gray-200/80 text-xs">
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit BOM
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Bahan</th>
                <th className="px-4 py-3 text-left font-semibold whitespace-nowrap">Satuan</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Qty Resep</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Dibutuhkan</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Stok</th>
                <th className="px-4 py-3 text-center font-semibold whitespace-nowrap">Status</th>
                <th className="px-4 py-3 text-right font-semibold whitespace-nowrap">Biaya Baris</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                    Memuat resep (BOM)...
                  </td>
                </tr>
              ) : failed ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                    <p>Gagal memuat resep (BOM).</p>
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Coba Lagi
                    </Button>
                  </td>
                </tr>
              ) : !hasLines ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                    <p>{isProduct ? "Produk" : "Bahan baku"} ini belum memiliki resep (BOM).</p>
                    <Link href={bomEditorHref}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 border-pink-200 text-pink-700 hover:bg-pink-50"
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Atur Resep (BOM)
                      </Button>
                    </Link>
                  </td>
                </tr>
              ) : (
                materials.map((material) => {
                  const { required, lineTotal, shortage } = bomLineRequirement(material, plannedQty);
                  return (
                    <tr key={material.bahan_id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-gray-900">{displayName(material.nama)}</p>
                          {material.material_type === "WIP" && (
                            <Badge variant="outline" className="border-sky-200/80 bg-sky-50 text-xs text-sky-700">
                              WIP
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">{material.kode || "-"}</p>
                      </td>
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <Badge variant="outline" className="border-gray-200/80 bg-gray-50 font-normal text-gray-700">
                          {material.satuan || "-"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums text-gray-700 whitespace-nowrap">
                        <p>{formatNumber(material.jumlah, 3)}</p>
                        <p className="text-xs text-gray-500">Susut {formatNumber(material.waste_percentage, 3)}%</p>
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums font-medium text-gray-900 whitespace-nowrap">
                        {formatNumber(required, 3)}
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums whitespace-nowrap">
                        <span className={shortage > 0 ? "font-medium text-red-600" : "font-medium text-gray-900"}>
                          {formatNumber(material.qty_available, 3)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center align-top whitespace-nowrap">
                        {shortage > 0 ? (
                          <Badge variant="outline" className="border-red-200/80 bg-red-50 text-red-700">
                            Kurang {formatNumber(shortage, 3)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50 text-emerald-700">
                            Cukup
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums whitespace-nowrap">
                        <p className="font-semibold text-pink-700">{formatNumber(lineTotal)}</p>
                        <p className="text-xs text-gray-500">@ {formatNumber(material.unit_cost)}</p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {hasLines && !loading && (
              <tfoot className="border-t border-gray-200/70 bg-gray-50/80">
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Total biaya bahan
                  </td>
                  <td className="px-4 py-3 text-right text-base font-bold tabular-nums text-pink-700">
                    {formatNumber(materialCost)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
