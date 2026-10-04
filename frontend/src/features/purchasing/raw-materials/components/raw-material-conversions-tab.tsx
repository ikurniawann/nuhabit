"use client";

import Link from "next/link";
import { Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { ITEMS_RAW_MATERIALS_PATH } from "@/lib/purchasing/item-routes";
import type { RawMaterialUnitConversion, RawMaterialWithStock } from "@/types/purchasing";

interface RawMaterialConversionsTabProps {
  material: RawMaterialWithStock;
  satuanBesarName: string;
  satuanKecilName: string;
}

const conversionUnitLabel = (conversion: RawMaterialUnitConversion) =>
  conversion.satuan?.simbol || conversion.satuan?.kode || conversion.satuan?.nama || "-";

const conversionUnitName = (conversion: RawMaterialUnitConversion) =>
  conversion.satuan?.nama || conversionUnitLabel(conversion);

/** Satuan dasar, konversi utama, dan satuan alternatif bahan baku. */
export function RawMaterialConversionsTab({ material, satuanBesarName, satuanKecilName }: RawMaterialConversionsTabProps) {
  const unitConversions = material.unit_conversions?.filter((conversion) => conversion.is_active !== false) || [];
  const baseConversion = unitConversions.find((conversion) => conversion.is_base) || unitConversions[0];
  const baseUnitLabel =
    baseConversion?.satuan?.simbol ||
    baseConversion?.satuan?.kode ||
    baseConversion?.satuan?.nama ||
    (material.satuan_kecil_id ? satuanKecilName : satuanBesarName);
  const alternativeConversions = unitConversions.filter((conversion) => !conversion.is_base);

  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Konversi Satuan</CardTitle>
            <p className="mt-1 text-sm text-gray-500">
              Satuan yang tersedia untuk pembelian, daftar harga, dan acuan stok.
            </p>
          </div>
          <Link href={`${ITEMS_RAW_MATERIALS_PATH}/edit/${material.id}`}>
            <Button variant="outline" className="purchasing-secondary-button w-full sm:w-auto">
              <Edit className="mr-2 h-4 w-4" />
              Ubah Konversi
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Satuan Dasar Stok</p>
            <p className="mt-2 text-lg font-bold text-gray-900">
              {baseConversion ? conversionUnitName(baseConversion) : baseUnitLabel}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Nilai konversi dasar selalu dihitung sebagai 1 {baseUnitLabel}.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200/70 bg-gray-50/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Konversi Utama</p>
            <p className="mt-2 text-lg font-bold text-gray-900">
              {material.satuan_kecil_id
                ? `1 ${satuanBesarName} = ${formatNumber(material.konversi_factor || 1, 4)} ${baseUnitLabel}`
                : `1 ${satuanBesarName} = 1 ${baseUnitLabel}`}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Diturunkan dari satuan besar dan faktor konversi utama.
            </p>
          </div>
        </div>

        {alternativeConversions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200/70 bg-white px-4 py-8 text-center">
            <p className="text-sm font-medium text-gray-700">Belum ada satuan alternatif</p>
            <p className="mt-1 text-sm text-gray-500">
              Tambahkan satuan alternatif di halaman ubah jika supplier menjual bahan ini dalam satuan berbeda.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto px-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Satuan</th>
                  <th className="px-4 py-3 text-left font-semibold">Jumlah dalam Satuan Dasar</th>
                  <th className="px-4 py-3 text-left font-semibold">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {alternativeConversions.map((conversion) => (
                  <tr key={conversion.id || conversion.satuan_id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{conversionUnitName(conversion)}</div>
                      <div className="text-xs text-gray-500">{conversionUnitLabel(conversion)}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {formatNumber(conversion.qty_in_base_unit, 4)} {baseUnitLabel}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      1 {conversionUnitLabel(conversion)} = {formatNumber(conversion.qty_in_base_unit, 4)}{" "}
                      {baseUnitLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
