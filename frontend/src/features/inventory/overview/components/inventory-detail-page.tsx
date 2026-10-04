"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MOVEMENT_TIPE_LABELS,
  MOVEMENT_TYPE_COLORS,
  STOCK_STATUS_COLORS,
  STOCK_STATUS_LABELS,
} from "@/lib/inventory/movement-labels";
import {
  ArrowLeftIcon,
  CubeIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useInventoryItem, useInventoryMovements } from "../queries";
import { formatDate, formatRupiah } from "@/lib/format";

export function InventoryDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [page, setPage] = useState(1);
  const limit = 25;

  const inventoryQuery = useInventoryItem(id);
  const inventory = inventoryQuery.data ?? null;
  const loading = inventoryQuery.isLoading;

  const movementsQuery = useInventoryMovements(id, page, limit);
  const movements = movementsQuery.data?.data ?? [];
  const movLoading = movementsQuery.isLoading || movementsQuery.isFetching;
  const totalPages = Math.max(
    1,
    Math.ceil((movementsQuery.data?.total ?? 0) / limit),
  );

  const movIcon = (tipe: string) => {
    if (tipe === "in" || tipe === "return")
      return <ArrowUpIcon className="w-3.5 h-3.5" />;
    if (tipe === "out") return <ArrowDownIcon className="w-3.5 h-3.5" />;
    return <ArrowPathIcon className="w-3.5 h-3.5" />;
  };

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );

  if (!inventory)
    return (
      <div className="text-center py-16 text-gray-400">
        <CubeIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Data inventory tidak ditemukan</p>
        <Link href="/dashboard/inventory" className="mt-3 inline-block">
          <Button variant="outline" size="sm">
            Kembali
          </Button>
        </Link>
      </div>
    );

  const statusCls =
    STOCK_STATUS_COLORS[
      inventory.stock_status as keyof typeof STOCK_STATUS_COLORS
    ] || "bg-gray-100 text-gray-600";
  const statusLabel =
    STOCK_STATUS_LABELS[
      inventory.stock_status as keyof typeof STOCK_STATUS_LABELS
    ] || inventory.stock_status;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/inventory">
          <Button variant="outline" size="sm">
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            Kembali
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {inventory.material_nama}
          </h1>
          <p className="text-sm text-gray-500 font-mono">
            {inventory.material_kode}
          </p>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm bg-blue-50">
          <CardContent className="pt-4">
            <p className="text-xs text-blue-600 mb-1">Stok Tersedia</p>
            <p className="text-3xl font-bold text-blue-700">
              {Number(inventory.qty_available).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-yellow-50">
          <CardContent className="pt-4">
            <p className="text-xs text-yellow-600 mb-1">Stok Minimum</p>
            <p className="text-3xl font-bold text-yellow-700">
              {Number(inventory.qty_minimum).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-green-50">
          <CardContent className="pt-4">
            <p className="text-xs text-green-600 mb-1">Nilai Inventory</p>
            <p className="text-xl font-bold text-green-700">
              {formatRupiah(inventory.total_value || 0)}
            </p>
            <p className="text-xs text-green-500">
              @ {formatRupiah(inventory.unit_cost || 0)}/unit
            </p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-4">
            <p className="text-xs text-gray-500 mb-1">Status Stok</p>
            <span
              className={`inline-flex px-2 py-1 rounded-full text-sm font-semibold border ${statusCls}`}
            >
              {statusLabel}
            </span>
            {inventory.lokasi_rak && (
              <p className="text-xs text-gray-400 mt-2">
                📍 {inventory.lokasi_rak}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Movement History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowPathIcon className="w-5 h-5 text-gray-500" />
            Pergerakan Stok
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y">
                <tr>
                  {[
                    "Tanggal",
                    "Tipe",
                    "Jumlah",
                    "Stok Sebelum",
                    "Stok Sesudah",
                    "Referensi",
                    "Alasan",
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left py-3 px-4 font-medium text-gray-700 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {movLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      Memuat...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      <ArrowPathIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      Belum ada pergerakan stok
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => {
                    const movCls =
                      MOVEMENT_TYPE_COLORS[
                        m.tipe as keyof typeof MOVEMENT_TYPE_COLORS
                      ] || "bg-gray-100 text-gray-600";
                    const movLabel = MOVEMENT_TIPE_LABELS[m.tipe] || m.tipe;
                    const isIn = ["in", "return"].includes(m.tipe);
                    return (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                          {formatDate(m.created_at)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${movCls}`}
                          >
                            {movIcon(m.tipe)}
                            {movLabel}
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 font-bold ${isIn ? "text-green-600" : "text-red-600"}`}
                        >
                          {isIn ? "+" : "-"}
                          {Number(m.jumlah).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {Number(m.qty_before).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 font-semibold">
                          {Number(m.qty_after).toFixed(2)}
                        </td>
                        <td className="py-3 px-4">
                          {m.reference_number ? (
                            <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                              {m.reference_number}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs">
                              {m.reference_type || "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs max-w-[200px] truncate">
                          {m.alasan || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 p-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </Button>
              <span className="text-sm text-gray-500 self-center">
                Hal {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
