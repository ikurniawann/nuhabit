"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CubeIcon,
  MagnifyingGlassIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useInventoryList, useInventorySummary } from "../queries";
import type { StockStatus } from "../types";
import { formatDate, formatRupiah } from "@/lib/format";

const STATUS_CONFIG: Record<
  StockStatus,
  { label: string; cls: string; icon: ComponentType<{ className?: string }> }
> = {
  normal: {
    label: "Normal",
    cls: "bg-green-100 text-green-700 border-green-200",
    icon: CheckCircleIcon,
  },
  low_stock: {
    label: "Stok Rendah",
    cls: "bg-yellow-100 text-yellow-700 border-yellow-200",
    icon: ExclamationTriangleIcon,
  },
  out_of_stock: {
    label: "Habis",
    cls: "bg-red-100 text-red-700 border-red-200",
    icon: XCircleIcon,
  },
  overstock: {
    label: "Berlebih",
    cls: "bg-blue-100 text-blue-700 border-blue-200",
    icon: ChartBarIcon,
  },
};

export function InventoryPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const limit = 20;

  const listQuery = useInventoryList({
    page,
    limit,
    status: statusFilter,
    search: appliedSearch || undefined,
  });
  const items = listQuery.data?.items ?? [];
  const loading = listQuery.isLoading;
  const totalPages = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / limit),
  );

  const summaryQuery = useInventorySummary();
  const summary = summaryQuery.data ?? {
    total: 0,
    low: 0,
    out: 0,
    totalValue: 0,
  };

  const applySearch = () => {
    setPage(1);
    setAppliedSearch(search.trim());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">
            Kelola stok dan pergerakan bahan baku
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <CubeIcon className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-xs text-blue-600">Total Item</p>
                <p className="text-2xl font-bold text-blue-700">
                  {summary.total}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-yellow-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-yellow-500" />
              <div>
                <p className="text-xs text-yellow-600">Stok Rendah</p>
                <p className="text-2xl font-bold text-yellow-700">
                  {summary.low}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-red-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <XCircleIcon className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-xs text-red-600">Stok Habis</p>
                <p className="text-2xl font-bold text-red-700">{summary.out}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-green-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <ChartBarIcon className="w-8 h-8 text-green-500" />
              <div>
                <p className="text-xs text-green-600">Nilai Total</p>
                <p className="text-lg font-bold text-green-700">
                  {formatRupiah(summary.totalValue)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Cari kode atau nama bahan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applySearch()}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="low_stock">Stok Rendah</SelectItem>
              <SelectItem value="out_of_stock">Habis</SelectItem>
              <SelectItem value="overstock">Berlebih</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={applySearch} variant="outline">
            Cari
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CubeIcon className="w-5 h-5" />
            Daftar Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y">
                <tr>
                  {[
                    "Kode",
                    "Nama Bahan",
                    "Kategori",
                    "Stok Tersedia",
                    "Stok Minimum",
                    "Unit",
                    "Status",
                    "Nilai Inventory",
                    "Terakhir Update",
                    "Aksi",
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
                {loading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-12 text-center text-gray-400"
                    >
                      Memuat...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="py-16 text-center text-gray-400"
                    >
                      <CubeIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>Belum ada data inventory</p>
                      <p className="text-xs mt-1">
                        Data akan muncul otomatis setelah GRN dibuat
                      </p>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const sc =
                      STATUS_CONFIG[item.stock_status] || STATUS_CONFIG.normal;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4 font-mono text-xs text-gray-600">
                          {item.material_kode}
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {item.material_nama}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {item.material_kategori || "—"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-blue-700">
                          {Number(item.qty_available).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {Number(item.qty_minimum).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-gray-600 font-medium">
                          {item.satuan || "Pcs"}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sc.cls}`}
                          >
                            <sc.icon className="w-3 h-3" />
                            {sc.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-gray-800">
                          {formatRupiah(item.total_value || 0)}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {item.last_movement_at
                            ? formatDate(item.last_movement_at)
                            : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <Link href={`/dashboard/inventory/${item.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs"
                            >
                              History
                            </Button>
                          </Link>
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
