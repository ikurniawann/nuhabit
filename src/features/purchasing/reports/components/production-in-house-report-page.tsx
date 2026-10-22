"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowPathIcon, DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STALL_LABELS } from "@/lib/configuration/stall-labels";
import { formatRupiah } from "@/lib/purchasing/utils";
import { listStockWarehouses } from "@/features/inventory/stock/api";
import { useProductList } from "@/features/purchasing/products/queries";
import { PRODUCT_ROUTES } from "@/modules/purchasing/constants/item-routes";
import { exportProductionInHouseReport } from "../api";
import { useProductionInHouseReport } from "../queries";
import type { ProductionDateField, ProductionOutputTypeFilter } from "../types";

const DATE_FIELD_OPTIONS = [
  { value: "completed_at", label: "Tanggal Selesai" },
  { value: "created_at", label: "Tanggal Dibuat" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "DRAFT", label: "Draf" },
  { value: "RELEASED", label: "Dirilis" },
  { value: "IN_PROGRESS", label: "Dalam Proses" },
  { value: "COMPLETED", label: "Selesai" },
  { value: "CANCELLED", label: "Dibatalkan" },
];

const OUTPUT_OPTIONS = [
  { value: "all", label: "Semua Output" },
  { value: "FINISHED_GOOD", label: "Barang Jadi" },
  { value: "WIP", label: "WIP" },
];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-gray-200/80 bg-gray-50 text-gray-700",
  RELEASED: "border-blue-200/80 bg-blue-50 text-blue-700",
  IN_PROGRESS: "border-amber-200/80 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-red-200/80 bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draf",
  RELEASED: "Dirilis",
  IN_PROGRESS: "Dalam Proses",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toUpperCase();
  return (
    <Badge
      variant="outline"
      className={STATUS_STYLES[key] || "border-border bg-muted/50 text-muted-foreground"}
    >
      {STATUS_LABELS[key] || status}
    </Badge>
  );
}

export function ProductionInHouseReportPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<ProductionDateField>("completed_at");
  const [statusFilter, setStatusFilter] = useState("all");
  const [outputType, setOutputType] = useState<ProductionOutputTypeFilter>("all");
  const [productId, setProductId] = useState("all");
  const [warehouseId, setWarehouseId] = useState("all");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [exporting, setExporting] = useState(false);

  const productsQuery = useProductList({ is_active: true, limit: 200 });
  const productOptions = useMemo(
    () => [
      { value: "all", label: "Semua Produk" },
      ...(productsQuery.data?.data ?? []).map((p) => ({
        value: p.id,
        label: `${p.kode || "-"} — ${p.nama}`,
      })),
    ],
    [productsQuery.data?.data]
  );

  const warehouseOptions = useMemo(
    () => [
      { value: "all", label: STALL_LABELS.allBranchTotal },
      ...warehouses.map((w) => ({
        value: w.id,
        label: `${w.code} — ${w.name}`,
      })),
    ],
    [warehouses]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingWarehouses(true);
    listStockWarehouses()
      .then((rows) => {
        if (!cancelled) setWarehouses(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error(`Gagal memuat daftar ${STALL_LABELS.singular.toLowerCase()}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingWarehouses(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reportQuery = useProductionInHouseReport({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    date_field: dateField,
    status: statusFilter === "all" ? undefined : statusFilter,
    output_type: outputType,
    product_id: productId === "all" ? undefined : productId,
    warehouse_id: warehouseId === "all" ? undefined : warehouseId,
  });

  const orders = reportQuery.data?.orders ?? [];
  const byStatus = reportQuery.data?.byStatus ?? [];
  const summary = reportQuery.data?.summary ?? {
    total_orders: 0,
    total_planned_qty: 0,
    total_actual_qty: 0,
    total_hpp_value: 0,
    completed_orders: 0,
  };
  const loading = reportQuery.isLoading || reportQuery.isFetching;

  useEffect(() => {
    if (reportQuery.isError) {
      toast.error(
        reportQuery.error instanceof Error
          ? reportQuery.error.message
          : "Gagal memuat laporan Produksi Internal"
      );
    }
  }, [reportQuery.isError, reportQuery.error]);

  const maxStatusValue =
    byStatus.length > 0 ? Math.max(...byStatus.map((s) => s.hpp_value), 1) : 1;

  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const blob = await exportProductionInHouseReport({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        date_field: dateField,
        status: statusFilter === "all" ? undefined : statusFilter,
        output_type: outputType,
        product_id: productId === "all" ? undefined : productId,
        warehouse_id: warehouseId === "all" ? undefined : warehouseId,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `production-in-house-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV berhasil diexport");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengekspor CSV");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Produksi Internal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rekap order produksi produk per periode, status, tipe output, dan nilai HPP.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reportQuery.refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || orders.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting ? "Mengekspor..." : "Ekspor CSV"}
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Dari Tanggal</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sampai Tanggal</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mode Tanggal</Label>
              <Combobox
                options={DATE_FIELD_OPTIONS}
                value={dateField}
                onChange={(value) => setDateField(value as ProductionDateField)}
                placeholder="Tanggal Selesai"
                searchPlaceholder="Cari mode..."
                emptyMessage="Tidak ditemukan"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Combobox
                options={STATUS_OPTIONS}
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="Semua Status"
                searchPlaceholder="Cari status..."
                emptyMessage="Status tidak ditemukan"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipe Output</Label>
              <Combobox
                options={OUTPUT_OPTIONS}
                value={outputType}
                onChange={(value) => setOutputType(value as ProductionOutputTypeFilter)}
                placeholder="Semua Output"
                searchPlaceholder="Cari output..."
                emptyMessage="Tidak ditemukan"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Produk</Label>
              <Combobox
                options={productOptions}
                value={productId}
                onChange={setProductId}
                placeholder="Semua Produk"
                searchPlaceholder="Cari produk..."
                emptyMessage="Produk tidak ditemukan"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label className="text-xs">{STALL_LABELS.singular}</Label>
              <Combobox
                options={warehouseOptions}
                value={warehouseId}
                onChange={setWarehouseId}
                placeholder={loadingWarehouses ? STALL_LABELS.loading : STALL_LABELS.allBranchTotal}
                searchPlaceholder={STALL_LABELS.search}
                emptyMessage={STALL_LABELS.empty}
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Order</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{summary.total_orders}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.completed_orders} completed
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Qty Planned</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatQty(summary.total_planned_qty)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Rencana produksi</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Qty Actual</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">
              {formatQty(summary.total_actual_qty)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Hasil aktual</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total HPP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">
              {formatRupiah(summary.total_hpp_value)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Nilai produksi</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Breakdown Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : byStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
            ) : (
              byStatus.map((item) => {
                const pct =
                  summary.total_hpp_value > 0
                    ? (item.hpp_value / summary.total_hpp_value) * 100
                    : 0;
                const barPct = maxStatusValue > 0 ? (item.hpp_value / maxStatusValue) * 100 : 0;
                return (
                  <div key={item.status} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {STATUS_LABELS[item.status] || item.status}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.count} order · {formatQty(item.actual_qty)} qty
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {formatRupiah(item.hpp_value)}
                        </p>
                        <p className="text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary/70 transition-all"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Daftar Order Produksi</CardTitle>
            <Badge
              variant="secondary"
              className="border-border bg-muted/50 text-muted-foreground"
            >
              {orders.length} baris
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-280 text-sm">
                <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">No Produksi</th>
                    <th className="px-3 py-3">Produk</th>
                    <th className="px-3 py-3">Output</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Planned</th>
                    <th className="px-3 py-3 text-right">Actual</th>
                    <th className="px-3 py-3 text-right">HPP/Unit</th>
                    <th className="px-3 py-3 text-right">Total HPP</th>
                    <th className="px-3 py-3">{STALL_LABELS.singular}</th>
                    <th className="px-3 py-3">Tanggal</th>
                    <th className="px-3 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground">
                        Memuat data...
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-12 text-center text-muted-foreground">
                        Tidak ada data produksi untuk filter ini
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-t border-gray-200/70 hover:bg-muted/30"
                      >
                        <td className="px-3 py-3 font-medium text-primary">
                          {order.nomor_produksi}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-foreground">{order.product_nama}</div>
                          <div className="text-xs text-muted-foreground">{order.product_kode}</div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {order.output_type === "WIP" ? "WIP" : "Barang Jadi"}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {formatQty(order.planned_qty)}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-foreground">
                          {formatQty(order.actual_qty)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {order.hpp_per_unit_formatted}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-foreground">
                          {order.total_hpp_value_formatted}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {order.warehouse_name || order.warehouse_code || "-"}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          <div>
                            {dateField === "created_at"
                              ? formatDate(order.created_at)
                              : formatDate(order.completed_at)}
                          </div>
                          {dateField === "completed_at" && order.created_at ? (
                            <div className="text-xs">buat {formatDate(order.created_at)}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Link href={PRODUCT_ROUTES.productionOrder(order.id)}>
                            <Button variant="outline" size="sm" className="h-8">
                              Detail
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
              Total HPP: {formatRupiah(summary.total_hpp_value)} · Filter tanggal:{" "}
              {dateField === "completed_at" ? "Tanggal Selesai" : "Tanggal Dibuat"}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
