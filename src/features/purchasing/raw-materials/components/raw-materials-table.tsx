"use client";

import Link from "next/link";
import { AlertCircle, Eye, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { ITEMS_RAW_MATERIALS_PATH } from "@/lib/purchasing/item-routes";
import type { MaterialCategory, RawMaterialWithStock } from "@/types/purchasing";
import { getRawMaterialUnitInfo, largeToBaseUnit } from "../unit-math";

const STOCK_STATUS_STYLES: Record<string, string> = {
  AMAN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MENIPIS: "border-amber-200 bg-amber-50 text-amber-700",
  HABIS: "border-red-200 bg-red-50 text-red-700",
};

const STOCK_STATUS_LABELS: Record<string, string> = {
  AMAN: "Aman",
  MENIPIS: "Stok Menipis",
  HABIS: "Stok Habis",
};

function StockStatusBadge({ status }: { status: string }) {
  const normalized = status || "AMAN";
  return (
    <Badge variant="outline" className={STOCK_STATUS_STYLES[normalized] || STOCK_STATUS_STYLES.AMAN}>
      {normalized === "MENIPIS" || normalized === "HABIS" ? <AlertCircle className="mr-1 inline h-3 w-3" /> : null}
      {STOCK_STATUS_LABELS[normalized] || normalized}
    </Badge>
  );
}

interface RawMaterialsTableProps {
  materials: RawMaterialWithStock[];
  categoryLabel: (kategori?: MaterialCategory | null) => string;
  statusUpdatingId: string | null;
  onToggleStatus: (material: RawMaterialWithStock, nextStatus: boolean) => void;
  onDelete: (material: RawMaterialWithStock) => void;
}

export function RawMaterialsTable({
  materials,
  categoryLabel,
  statusUpdatingId,
  onToggleStatus,
  onDelete,
}: RawMaterialsTableProps) {
  return (
  <div className="overflow-x-auto px-4">
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
          <th className="py-3 pr-4 text-left font-semibold">Kode</th>
          <th className="px-3 py-3 text-left font-semibold">Nama Bahan</th>
          <th className="px-3 py-3 text-left font-semibold">Kategori</th>
          <th className="px-3 py-3 text-left font-semibold">COA</th>
          <th className="px-3 py-3 text-right font-semibold">Stok Tersedia</th>
          <th className="px-3 py-3 text-right font-semibold">Stok Minimum</th>
          <th className="px-3 py-3 text-right font-semibold">Harga Rata-rata</th>
          <th className="px-3 py-3 text-center font-semibold">Status Stok</th>
          <th className="px-3 py-3 text-center font-semibold">Aktif</th>
          <th className="py-3 pl-3 text-right font-semibold">Aksi</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200/70">
        {materials.map((material) => {
          const unitInfo = getRawMaterialUnitInfo(material);
          // qty_onhand & stok_minimum sama-sama tersimpan dalam SATUAN BESAR,
          // sementara kolom ini dilabeli satuan dasar. Sebelumnya hanya
          // stok minimum yang dikonversi, sehingga mis. beras 8 karung
          // tampil sebagai "8 Kilogram" berdampingan dengan minimum
          // "50 Kilogram" — terbaca seolah stok di bawah minimum.
          const qtyOnHand = largeToBaseUnit(
            material.qty_onhand ?? 0,
            unitInfo.konversiFactor
          );
          const minStock = largeToBaseUnit(
            material.stok_minimum ?? 0,
            unitInfo.konversiFactor
          );
          const unitLabel = unitInfo.baseUnitName;

          return (
            <tr key={material.id} className="transition-colors hover:bg-gray-50/80">
              <td className="py-3 pr-4">
                <span className="font-medium text-gray-900">{material.kode}</span>
              </td>
              <td className="px-3 py-3">
                <Link
                  href={`${ITEMS_RAW_MATERIALS_PATH}/${material.id}`}
                  className="font-medium text-pink-700 hover:underline"
                >
                  {material.nama}
                </Link>
              </td>
              <td className="px-3 py-3 text-gray-700">
                {categoryLabel(material.kategori)}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {material.coa_production && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      Produksi {material.coa_production}
                    </Badge>
                  )}
                  {material.coa_rnd && (
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                      R&amp;D {material.coa_rnd}
                    </Badge>
                  )}
                  {material.coa_asset && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Aset {material.coa_asset}
                    </Badge>
                  )}
                  {!material.coa_production && !material.coa_rnd && !material.coa_asset && (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-right">
                <span
                  className={
                    qtyOnHand <= 0
                      ? "font-semibold text-red-600"
                      : qtyOnHand <= minStock
                        ? "font-semibold text-amber-600"
                        : "text-gray-700"
                  }
                >
                  {formatNumber(qtyOnHand, 4)}
                </span>
                <span className="ml-1 text-xs text-gray-500">{unitLabel}</span>
              </td>
              <td className="px-3 py-3 text-right text-gray-700">
                {formatNumber(minStock, 4)}
                <span className="ml-1 text-xs text-gray-500">{unitLabel}</span>
              </td>
              <td className="px-3 py-3 text-right text-gray-700">
                {(material.avg_cost ?? 0) > 0 ? formatNumber(material.avg_cost) : "-"}
              </td>
              <td className="px-3 py-3 text-center">
                <StockStatusBadge status={material.status_stok ?? "AMAN"} />
              </td>
              <td className="px-3 py-3 text-center">
                <div className="flex items-center justify-center">
                  <Switch
                    checked={material.is_active ?? true}
                    disabled={statusUpdatingId === material.id}
                    onCheckedChange={(checked) => onToggleStatus(material, checked)}
                    aria-label={`Ubah status aktif ${material.nama}`}
                  />
                </div>
              </td>
              <td className="py-3 pl-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Link href={`${ITEMS_RAW_MATERIALS_PATH}/${material.id}`}>
                    <Button variant="ghost" size="sm" className="cursor-pointer" title="Lihat Detail">
                      <Eye className="h-4 w-4 text-pink-600" />
                    </Button>
                  </Link>
                  <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
                    <Button variant="ghost" size="sm" className="cursor-pointer" title="Ubah">
                      <Pencil className="h-4 w-4 text-gray-600" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer text-red-500 hover:text-red-600"
                    title="Hapus"
                    onClick={() => onDelete(material)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
}
