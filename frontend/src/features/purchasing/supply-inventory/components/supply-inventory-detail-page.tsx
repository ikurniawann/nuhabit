"use client";

import { use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { ArrowLeft, PackageMinus } from "lucide-react";
import { useSupplyStockDetail } from "../queries";
import { MOVEMENT_LABELS, MOVEMENT_STYLES } from "../types";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-gray-50/70 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function SupplyInventoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, isError, error } = useSupplyStockDetail(id);

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-gray-500">Memuat kartu stok...</div>;
  }
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Gagal memuat detail stok"}
      </div>
    );
  }

  const low = data.qty_available <= data.qty_minimum;

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title={data.item_nama || "Stok"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
              {data.item_kode || "-"}
            </span>
            <span className="text-gray-300">•</span>
            <span>{data.warehouse_nama || "Tanpa gudang"}</span>
            {low && <Badge className="border-0 bg-amber-100 text-amber-700">Stok Menipis</Badge>}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Link href={GENERAL_ROUTES.inventory}>
              <Button variant="outline" className="purchasing-secondary-button">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Kembali
              </Button>
            </Link>
            <Link href={GENERAL_ROUTES.inventoryUsage}>
              <Button className="purchasing-main-button">
                <PackageMinus className="mr-2 h-4 w-4" />
                Pakai Barang
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBox label="Saldo Tersedia" value={`${formatNumber(data.qty_available, 3)} ${data.satuan_nama || ""}`} />
        <StatBox label="Stok Minimum" value={formatNumber(data.qty_minimum, 3)} />
        <StatBox label="HPP Rata²" value={formatRupiah(data.unit_cost)} hint="rata-rata tertimbang" />
        <StatBox
          label="Nilai Persediaan"
          value={formatRupiah(data.qty_available * data.unit_cost)}
        />
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardHeader className="border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Kartu Stok</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.movements.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">Belum ada pergerakan stok.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                    <th className="px-4 py-3 text-left font-semibold">Tipe</th>
                    <th className="px-4 py-3 text-left font-semibold">Referensi</th>
                    <th className="px-4 py-3 text-right font-semibold">Jumlah</th>
                    <th className="px-4 py-3 text-right font-semibold">Sebelum</th>
                    <th className="px-4 py-3 text-right font-semibold">Sesudah</th>
                    <th className="px-4 py-3 text-left font-semibold">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 text-gray-600">{formatDate(m.created_at)}</td>
                      <td className="px-4 py-3">
                        <Badge className={`border-0 ${MOVEMENT_STYLES[m.tipe]}`}>
                          {MOVEMENT_LABELS[m.tipe]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{m.reference_number || m.reference_type || "-"}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {m.tipe === "out" ? "-" : m.tipe === "in" ? "+" : ""}
                        {formatNumber(m.jumlah, 3)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">{formatNumber(m.qty_before, 3)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{formatNumber(m.qty_after, 3)}</td>
                      <td className="px-4 py-3 text-gray-500">{m.alasan || m.catatan || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
