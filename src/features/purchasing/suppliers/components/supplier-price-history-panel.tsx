"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Combobox } from "@/components/ui/combobox";
import { PriceHistoryChart } from "@/features/purchasing/suppliers/components/price-history-chart";
import { PriceHistoryTable } from "@/features/purchasing/suppliers/components/price-history-table";
import type { PurchasePriceHistoryItem } from "@/features/purchasing/suppliers/price-history-types";
import { useSupplierPriceHistory } from "../queries";
import { BarChart3, FileText, LineChart, Table as TableIcon, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";

interface SupplierPriceHistoryPanelProps {
  supplierId: string;
  supplierName?: string;
}

export function SupplierPriceHistoryPanel({
  supplierId,
  supplierName
}: SupplierPriceHistoryPanelProps) {
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<number>(6); // bulan
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");

  const historyQuery = useSupplierPriceHistory(supplierId, timeRange, selectedMaterial);
  const priceHistory = historyQuery.data ?? [];
  const loading = historyQuery.isFetching;
  const fetchData = () => historyQuery.refetch();

  useEffect(() => {
    if (historyQuery.isError) {
      const message = historyQuery.error instanceof Error ? historyQuery.error.message : "Kesalahan tidak diketahui";
      toast.error("Gagal memuat data harga pembelian: " + message);
    }
  }, [historyQuery.isError, historyQuery.error]);

  const materials = Array.from(
    new Map(priceHistory.map(item => [item.bahan_baku_id, item.bahan_baku_nama])).entries()
  ).map(([id, name]) => ({ id, name }));

  const groupedHistory = priceHistory.reduce((acc, item) => {
    if (!acc[item.bahan_baku_id]) {
      acc[item.bahan_baku_id] = [];
    }
    acc[item.bahan_baku_id].push(item);
    return acc;
  }, {} as Record<string, PurchasePriceHistoryItem[]>);

  const totalMaterials = materials.length;
  const totalPurchases = priceHistory.length;
  const changes = priceHistory
    .map((item) => item.price_change_percent)
    .filter((value): value is number => typeof value === "number");
  const avgPriceChange = changes.length > 0
    ? changes.reduce((sum, value) => sum + value, 0) / changes.length
    : 0;
  const hasHistory = priceHistory.length > 0;
  const materialOptions = [
    { value: "all", label: "Semua Bahan Baku" },
    ...materials.map((material) => ({ value: material.id, label: material.name })),
  ];
  const timeRangeOptions = [
    { value: "3", label: "3 Bulan Terakhir" },
    { value: "6", label: "6 Bulan Terakhir" },
    { value: "12", label: "12 Bulan Terakhir" },
    { value: "24", label: "24 Bulan Terakhir" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <BarChart3 className="h-5 w-5 text-pink-600" />
            Riwayat Harga Pembelian
          </h2>
          <p className="text-sm text-gray-500">
            {supplierName || "Supplier"} - {totalMaterials} bahan baku • {totalPurchases} penerimaan
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          disabled={loading}
          className="purchasing-secondary-button w-full sm:w-auto"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Muat Ulang
        </Button>
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-gray-200/70 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Bahan Baku</p>
                <p className="text-2xl font-bold text-blue-600">{totalMaterials}</p>
              </div>
              <div className="p-2 bg-blue-50 rounded-lg">
                <TableIcon className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Penerimaan</p>
                <p className="text-2xl font-bold text-purple-600">{totalPurchases}</p>
              </div>
              <div className="p-2 bg-purple-50 rounded-lg">
                <TrendingUp className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200/70 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 font-medium">Rata-rata Perubahan</p>
                <p className={`text-2xl font-bold ${avgPriceChange > 0 ? "text-red-600" : avgPriceChange < 0 ? "text-green-600" : "text-gray-600"}`}>
                  {avgPriceChange > 0 ? "+" : ""}{avgPriceChange.toFixed(1)}%
                </p>
              </div>
              <div className="p-2 bg-gray-50 rounded-lg">
                {avgPriceChange > 0 ? (
                  <TrendingUp className="w-6 h-6 text-red-600" />
                ) : avgPriceChange < 0 ? (
                  <TrendingDown className="w-6 h-6 text-green-600" />
                ) : (
                  <Minus className="w-6 h-6 text-gray-600" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card className="border-gray-200/70 shadow-sm">
        <CardContent className="p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-gray-600 mb-1 block">
                Filter Bahan Baku
              </Label>
              <Combobox
                options={materialOptions}
                value={selectedMaterial}
                onChange={(value) => setSelectedMaterial(value || "all")}
                placeholder="Semua bahan baku"
                searchPlaceholder="Cari bahan baku..."
                emptyMessage="Bahan tidak ditemukan"
                className="h-9 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-600 mb-1 block">
                Periode Waktu
              </Label>
              <Combobox
                options={timeRangeOptions}
                value={String(timeRange)}
                onChange={(value) => setTimeRange(Number(value || 6))}
                placeholder="Pilih periode..."
                searchPlaceholder="Cari periode..."
                emptyMessage="Periode tidak ditemukan"
                className="h-9 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grafik & Tabel */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "chart" | "table")}
        className="flex-col space-y-4"
      >
        <TabsList
          variant="line"
          className="flex h-auto w-full justify-start gap-6 rounded-none border-b border-gray-200 bg-transparent p-0"
        >
          <TabsTrigger
            value="chart"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            <LineChart className="w-4 h-4 mr-2" />
            Grafik Tren
          </TabsTrigger>
          <TabsTrigger
            value="table"
            className="h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 text-sm font-semibold text-gray-500 shadow-none data-active:border-pink-600 data-active:!bg-transparent data-active:text-pink-700 data-active:shadow-none"
          >
            <TableIcon className="w-4 h-4 mr-2" />
            Tabel Riwayat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chart" className="mt-0 w-full min-w-0">
          <Card className="border-gray-200/70 shadow-sm">
            <CardHeader className="border-b border-gray-200/70 px-4 py-3">
              <CardTitle className="text-base">
                Tren Harga {selectedMaterial === "all" ? "Semua Bahan Baku" : materials.find(m => m.id === selectedMaterial)?.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-hidden p-4">
              {loading ? (
                <div className="h-[300px] flex items-center justify-center text-gray-400">
                  Memuat data...
                </div>
              ) : !hasHistory ? (
                <EmptyPriceHistory
                  title="Belum ada riwayat pembelian"
                  description={
                    selectedMaterial === "all"
                      ? "Belum ada penerimaan barang dari supplier ini pada periode yang dipilih."
                      : "Bahan baku yang dipilih belum pernah diterima pada periode ini."
                  }
                />
              ) : selectedMaterial === "all" ? (
                <div className="space-y-8">
                  {Object.entries(groupedHistory).slice(0, 5).map(([materialId, items]) => (
                    <div key={materialId} className="rounded-lg border border-gray-200/70 p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">
                        {items[0]?.bahan_baku_nama}
                      </h4>
                      <PriceHistoryChart
                        data={items}
                        height={250}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <PriceHistoryChart
                  data={priceHistory}
                  materialName={materials.find(m => m.id === selectedMaterial)?.name}
                  height={350}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="table" className="mt-0 w-full min-w-0">
          <Card className="border-gray-200/70 shadow-sm">
            <CardHeader className="border-b border-gray-200/70 px-4 py-3">
              <CardTitle className="text-base">
                Detail Penerimaan &amp; Harga
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {loading ? (
                <div className="text-center py-8 text-gray-400">Memuat data...</div>
              ) : !hasHistory ? (
                <EmptyPriceHistory
                  title="Belum ada data tabel"
                  description="Tidak ada riwayat pembelian yang bisa ditampilkan untuk filter saat ini."
                />
              ) : (
                <PriceHistoryTable
                  data={priceHistory}
                  showMaterialName={selectedMaterial === "all"}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyPriceHistory({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center">
      <div>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
          <FileText className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p>
        <p className="mt-3 text-xs text-gray-400">
          Harga diambil otomatis dari penerimaan barang (GRN) supplier ini.
        </p>
      </div>
    </div>
  );
}
