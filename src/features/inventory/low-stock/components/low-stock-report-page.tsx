"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/purchasing/utils";
import {
  ExclamationTriangleIcon,
  ArrowSmallDownIcon,
  ShoppingCartIcon,
  ArrowUpOnSquareIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { useLowStock } from "../queries";
import type { LowStockItem } from "../types";

export function LowStockReportPage() {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const lowStockQuery = useLowStock({
    category: categoryFilter,
    status: statusFilter,
  });
  const items = lowStockQuery.data ?? [];
  const loading = lowStockQuery.isLoading;

  const fetchLowStock = () => lowStockQuery.refetch();

  // Hitung summary
  const summary = {
    totalItems: items.length,
    outOfStock: items.filter(i => i.qty_available === 0).length,
    lowStock: items.filter(i => i.qty_available > 0 && i.qty_available < i.qty_minimum).length,
    totalReorderCost: items.reduce((sum, i) => sum + i.estimated_cost, 0),
  };

  // Export to CSV
  function exportToCSV() {
    const headers = ["Kode", "Nama Bahan", "Kategori", "Stok Saat Ini", "Minimum", "Kekurangan", "Saran Order", "Estimasi Biaya", "Supplier"];
    const rows = items.map(i => [
      i.material_kode,
      i.material_nama,
      i.kategori || "-",
      i.qty_available,
      i.qty_minimum,
      i.shortage_qty,
      i.suggested_order_qty,
      i.estimated_cost,
      i.supplier_name || "-"
    ]);

    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `low-stock-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📦 Low Stock Alert</h1>
          <p className="text-sm text-gray-500">Monitor stok bahan baku di bawah minimum</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLowStock}>
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportToCSV}>
            <ArrowUpOnSquareIcon className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm bg-red-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
              <div>
                <p className="text-xs text-red-600">Total Items</p>
                <p className="text-2xl font-bold text-red-700">{summary.totalItems}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-orange-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-8 h-8 text-orange-500" />
              <div>
                <p className="text-xs text-orange-600">Stok Habis</p>
                <p className="text-2xl font-bold text-orange-700">{summary.outOfStock}</p>
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
                <p className="text-2xl font-bold text-yellow-700">{summary.lowStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <ShoppingCartIcon className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-xs text-blue-600">Estimasi Reorder</p>
                <p className="text-lg font-bold text-blue-700">{formatRupiah(summary.totalReorderCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm text-gray-600 mb-1 block">Kategori</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  <SelectItem value="bahan_baku">Bahan Baku</SelectItem>
                  <SelectItem value="packaging">Packaging</SelectItem>
                  <SelectItem value="lainnya">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-600 mb-1 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="out_of_stock">Stok Habis (0)</SelectItem>
                  <SelectItem value="low_stock">Stok Rendah (&lt; minimum)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daftar Bahan Perlu Reorder</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-y">
                <tr>
                  {["Kode", "Nama Bahan", "Kategori", "Stok Saat Ini", "Minimum", "Kekurangan", "Saran Order", "Estimasi Biaya", "Supplier", "Aksi"].map(h => (
                    <th key={h} className="text-left py-3 px-4 font-medium text-gray-700 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={10} className="py-12 text-center text-gray-400">Memuat data...</td></tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center">
                      <CheckCircleIcon className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-50" />
                      <p className="text-gray-500">Semua stok aman! 🎉</p>
                      <p className="text-xs text-gray-400 mt-1">Tidak ada item di bawah minimum</p>
                    </td>
                  </tr>
                ) : (
                  items.map(item => {
                    const isOutOfStock = item.qty_available === 0;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4 font-mono text-xs text-gray-600">{item.material_kode}</td>
                        <td className="py-3 px-4 font-medium">{item.material_nama}</td>
                        <td className="py-3 px-4 text-gray-500 text-xs">{item.kategori || "—"}</td>
                        <td className={`py-3 px-4 font-semibold ${isOutOfStock ? 'text-red-600' : 'text-blue-700'}`}>
                          {item.qty_available.toFixed(2)} {item.satuan}
                        </td>
                        <td className="py-3 px-4 text-gray-500">{item.qty_minimum.toFixed(0)}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className={`${isOutOfStock ? 'bg-red-100 text-red-700 border-red-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                            {item.shortage_qty > 0 ? `-${item.shortage_qty}` : '0'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 font-medium text-blue-700">
                          {item.suggested_order_qty} {item.satuan}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {item.suggestion_basis === "maximum"
                              ? `s.d. maks ${item.qty_maximum}${item.qty_on_order > 0 ? `, ${item.qty_on_order} sudah dipesan` : ""}`
                              : "kekurangan x 1,5"}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-gray-800">
                          {formatRupiah(item.estimated_cost)}
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-xs">
                          {item.supplier_name || "—"}
                        </td>
                        <td className="py-3 px-4">
                          <Link href={buildPoInsertHref(item)}>
                            <Button variant="outline" size="sm" className="text-xs">
                              Buat PO
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
        </CardContent>
      </Card>
    </div>
  );
}

/** Prefill form PO baru: bahan baku, qty saran (satuan dasar), supplier terakhir. */
function buildPoInsertHref(item: LowStockItem): string {
  const params = new URLSearchParams({
    material_id: item.raw_material_id,
    qty: String(item.suggested_order_qty),
  });
  if (item.supplier_id) params.set("supplier_id", item.supplier_id);
  return `/dashboard/purchasing/po/insert?${params.toString()}`;
}
