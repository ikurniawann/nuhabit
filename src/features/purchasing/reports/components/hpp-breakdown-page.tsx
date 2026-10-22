"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalculatorIcon,
  MagnifyingGlassIcon,
  PrinterIcon,
  DocumentArrowDownIcon,
  CubeIcon,
} from "@heroicons/react/24/outline";
import { formatRupiah } from "@/lib/purchasing/utils";
import { useHppBreakdown } from "../queries";

export function HPPBreakdownPage() {
  const [search, setSearch] = useState("");

  const hppQuery = useHppBreakdown();
  const items = hppQuery.data ?? [];
  const loading = hppQuery.isLoading;

  const filtered = items.filter((item) =>
    !search ||
    (item.product_code?.toLowerCase().includes(search.toLowerCase())) ||
    (item.product_name?.toLowerCase().includes(search.toLowerCase()))
  );

  const avgHPP = filtered.length > 0
    ? filtered.reduce((sum, i) => sum + (i.hpp_per_unit || 0), 0) / filtered.length
    : 0;

  return (
    <div className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Breakdown HPP</h1>
          <p className="text-sm text-gray-500">Harga pokok produksi per produk</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <PrinterIcon className="w-4 h-4 mr-1" />Cetak
          </Button>
          <Button variant="outline" size="sm">
            <DocumentArrowDownIcon className="w-4 h-4 mr-1" />Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Produk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Rata-rata HPP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-pink-600">{formatRupiah(avgHPP)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Cari kode, nama produk..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium">Kode Produk</th>
                  <th className="text-left px-4 py-3 font-medium">Nama Produk</th>
                  <th className="text-left px-4 py-3 font-medium">Kategori</th>
                  <th className="text-right px-4 py-3 font-medium">Qty Produksi</th>
                  <th className="text-right px-4 py-3 font-medium">Biaya Bahan</th>
                  <th className="text-right px-4 py-3 font-medium">Biaya TK</th>
                  <th className="text-right px-4 py-3 font-medium">Overhead</th>
                  <th className="text-right px-4 py-3 font-medium">HPP/Unit</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">Memuat...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="flex flex-col items-center py-12 text-gray-400">
                        <CalculatorIcon className="w-12 h-12 mb-2" />
                        <p>Belum ada data HPP</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{item.product_code || "-"}</td>
                      <td className="px-4 py-3">{item.product_name || "-"}</td>
                      <td className="px-4 py-3">{item.category || "-"}</td>
                      <td className="px-4 py-3 text-right">{item.qty_produced?.toLocaleString() || "-"}</td>
                      <td className="px-4 py-3 text-right">{item.raw_material_cost ? formatRupiah(item.raw_material_cost) : "-"}</td>
                      <td className="px-4 py-3 text-right">{item.labor_cost ? formatRupiah(item.labor_cost) : "-"}</td>
                      <td className="px-4 py-3 text-right">{item.overhead_cost ? formatRupiah(item.overhead_cost) : "-"}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        {item.hpp_per_unit ? formatRupiah(item.hpp_per_unit) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
