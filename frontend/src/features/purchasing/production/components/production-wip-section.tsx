"use client";

import Link from "next/link";
import { Eye, Layers, Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { formatDate, formatNumber } from "@/lib/format";
import { displayName, toNumber } from "@/lib/purchasing/production-ui-display";
import type { WipInventory, WipSummary } from "../types";

type ProductionWipSectionProps = {
  items: WipInventory[];
  summary: WipSummary | null;
  loading: boolean;
  recipesRoute: string;
  stockCardRoute: (materialId: string) => string;
};

export function ProductionWipSection({
  items,
  summary,
  loading,
  recipesRoute,
  stockCardRoute,
}: ProductionWipSectionProps) {
  return (
    <PurchasingListSection
      icon={Layers}
      title="Stok WIP"
      description="Output WIP yang selesai ditambahkan ke stok bahan dan dapat dipakai sebagai komponen resep (BOM)."
      toolbar={
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-sky-200/80 bg-white text-sky-700">
            {summary?.total_wip || 0} item WIP
          </Badge>
          <Badge variant="outline" className="border-emerald-200/80 bg-white text-emerald-700">
            Nilai {formatNumber(summary?.total_value)}
          </Badge>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">WIP</th>
              <th className="px-4 py-3 text-left font-semibold">Produk Sumber</th>
              <th className="px-4 py-3 text-right font-semibold">Stok</th>
              <th className="px-4 py-3 text-right font-semibold">HPP WIP</th>
              <th className="px-4 py-3 text-left font-semibold">Batch Terakhir</th>
              <th className="px-4 py-3 text-right font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-pink-600" />
                  Memuat stok WIP...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                  Belum ada item WIP. Buat order produksi dengan output WIP, lalu dirilis, mulai, dan selesaikan.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{displayName(item.nama)}</p>
                    <p className="text-xs text-gray-500">{item.kode}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{displayName(item.source_product?.nama)}</p>
                    <p className="text-xs text-gray-500">{item.source_product?.kode || "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p
                      className={
                        toNumber(item.qty_onhand) > 0
                          ? "font-semibold text-emerald-700"
                          : "font-semibold text-red-600"
                      }
                    >
                      {formatNumber(item.qty_onhand, 3)} {item.satuan}
                    </p>
                    <p className="text-xs text-gray-500">{item.status_stok}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-pink-700">
                    {formatNumber(item.avg_cost)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.latest_batch?.batch_number || "-"}</p>
                    <p className="text-xs text-gray-500">
                      {item.latest_batch
                        ? `${formatNumber(item.latest_batch.qty_produced, 3)} qty · ${formatDate(item.latest_batch.created_at)}`
                        : "Belum ada batch"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Link href={stockCardRoute(item.id)}>
                        <Button variant="ghost" size="sm" title="Lihat kartu stok" className="cursor-pointer">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Link href={recipesRoute}>
                        <Button variant="ghost" size="sm" title="Gunakan di resep (BOM)" className="cursor-pointer">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PurchasingListSection>
  );
}
