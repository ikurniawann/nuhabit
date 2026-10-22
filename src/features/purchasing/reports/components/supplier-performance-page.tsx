"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowPathIcon,
  DocumentArrowDownIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah } from "@/lib/purchasing/utils";
import { useSupplierList } from "@/features/purchasing/suppliers/queries";
import { useSupplierPerformance } from "../queries";

function formatPct(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function ratingTone(rating?: number) {
  if (rating == null) return "text-muted-foreground";
  if (rating >= 4) return "text-emerald-600";
  if (rating >= 3) return "text-amber-600";
  return "text-red-600";
}

export function SupplierPerformancePage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("all");
  const [exporting, setExporting] = useState(false);

  const suppliersQuery = useSupplierList({ is_active: true, limit: 100 });
  const supplierOptions = useMemo(
    () => [
      { value: "all", label: "Semua Supplier" },
      ...(suppliersQuery.data?.data ?? []).map((s) => ({
        value: s.id,
        label: `${s.kode || s.kode_supplier || "-"} — ${s.nama_supplier}`,
      })),
    ],
    [suppliersQuery.data?.data]
  );

  const performanceQuery = useSupplierPerformance({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    supplier_id: supplierId === "all" ? undefined : supplierId,
  });
  const items = performanceQuery.data ?? [];
  const loading = performanceQuery.isLoading || performanceQuery.isFetching;

  useEffect(() => {
    if (performanceQuery.isError) {
      toast.error(
        performanceQuery.error instanceof Error
          ? performanceQuery.error.message
          : "Gagal memuat data performa supplier"
      );
    }
  }, [performanceQuery.isError, performanceQuery.error]);

  const totalSuppliers = items.length;
  const totalValue = items.reduce((sum, item) => sum + (item.total_value || 0), 0);
  const totalPo = items.reduce((sum, item) => sum + (item.total_po || 0), 0);
  const avgOnTime =
    items.filter((item) => item.on_time_rate != null).length > 0
      ? items
          .filter((item) => item.on_time_rate != null)
          .reduce((sum, item) => sum + (item.on_time_rate || 0), 0) /
        items.filter((item) => item.on_time_rate != null).length
      : null;
  const avgReject =
    items.length > 0
      ? items.reduce((sum, item) => sum + (item.reject_rate || 0), 0) / items.length
      : 0;

  const topSpend = useMemo(() => {
    return [...items]
      .sort((a, b) => (b.total_value || 0) - (a.total_value || 0))
      .slice(0, 8);
  }, [items]);

  const maxSpend = topSpend.length > 0 ? Math.max(...topSpend.map((i) => i.total_value || 0), 1) : 1;

  const handleExportCSV = () => {
    setExporting(true);
    try {
      const headers = [
        "Rank",
        "Kode",
        "Supplier",
        "Total PO",
        "On-Time",
        "Terlambat",
        "On-Time %",
        "Reject Rate (%)",
        "Lead Time (Hari)",
        "Total Nilai",
        "Rating",
        "Quality Score",
      ];
      const rows = items.map((item) => [
        String(item.rank || ""),
        item.supplier_code || "",
        item.supplier_name || "",
        String(item.total_po || 0),
        String(item.on_time_count || 0),
        String(item.late_count || 0),
        item.on_time_rate != null ? item.on_time_rate.toFixed(1) : "",
        item.reject_rate != null ? item.reject_rate.toFixed(1) : "",
        item.avg_lead_time_days != null ? item.avg_lead_time_days.toFixed(1) : "",
        String(item.total_value || 0),
        item.rating != null ? item.rating.toFixed(1) : "",
        item.quality_score != null ? String(item.quality_score) : "",
      ]);

      const csvContent = [
        headers.map((h) => `"${h}"`).join(","),
        ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supplier-performance-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV berhasil diexport");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supplier Performance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Evaluasi supplier berdasarkan ketepatan pengiriman, reject rate, lead time, dan nilai
            transaksi.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => performanceQuery.refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || items.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-3">
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
              <Label className="text-xs">Supplier</Label>
              <Combobox
                options={supplierOptions}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Semua Supplier"
                searchPlaceholder="Cari supplier..."
                emptyMessage="Supplier tidak ditemukan"
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Supplier Aktif
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{totalSuppliers}</p>
            <p className="mt-1 text-xs text-muted-foreground">{totalPo} PO dalam filter</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatRupiah(totalValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Nilai keseluruhan PO</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rata-rata On-Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">{formatPct(avgOnTime)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Dari delivery / GRN bertanggal</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rata-rata Reject
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${avgReject > 5 ? "text-red-600" : "text-foreground"}`}
            >
              {formatPct(avgReject)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Dari QC / qty GRN</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Top Spend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : topSpend.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
            ) : (
              topSpend.map((item) => {
                const value = item.total_value || 0;
                const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
                const barPct = maxSpend > 0 ? (value / maxSpend) * 100 : 0;
                return (
                  <div key={item.id} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {item.supplier_name || "-"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.total_po || 0} PO · Rating {item.rating?.toFixed(1) || "-"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {formatRupiah(value)}
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
            <CardTitle className="text-base">Ranking Supplier</CardTitle>
            <Badge
              variant="secondary"
              className="border-border bg-muted/50 text-muted-foreground"
            >
              {items.length} baris
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-280 text-sm">
                <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">Supplier</th>
                    <th className="px-3 py-3 text-right">Total PO</th>
                    <th className="px-3 py-3 text-right">On-Time</th>
                    <th className="px-3 py-3 text-right">Terlambat</th>
                    <th className="px-3 py-3 text-right">On-Time %</th>
                    <th className="px-3 py-3 text-right">Reject</th>
                    <th className="px-3 py-3 text-right">Lead Time</th>
                    <th className="px-3 py-3 text-right">Total Nilai</th>
                    <th className="px-3 py-3 text-center">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                        Memuat data...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                        Belum ada data performa supplier untuk filter ini
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr
                        key={item.id || item.supplier_name}
                        className="border-t border-gray-200/70 hover:bg-muted/30"
                      >
                        <td className="px-3 py-3 text-muted-foreground">{item.rank || "-"}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">
                            {item.supplier_name || "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.supplier_code || "-"}
                            {item.contact_person ? ` · ${item.contact_person}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-foreground">{item.total_po || 0}</td>
                        <td className="px-3 py-3 text-right text-emerald-600">
                          {item.on_time_count || 0}
                        </td>
                        <td className="px-3 py-3 text-right text-red-600">{item.late_count || 0}</td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {formatPct(item.on_time_rate)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.reject_rate != null ? (
                            <Badge
                              variant="outline"
                              className={
                                item.reject_rate > 5
                                  ? "border-red-200/80 bg-red-50 text-red-700"
                                  : "border-emerald-200/80 bg-emerald-50 text-emerald-700"
                              }
                            >
                              {item.reject_rate.toFixed(1)}%
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {item.avg_lead_time_days != null
                            ? `${item.avg_lead_time_days.toFixed(1)} hr`
                            : "-"}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-foreground">
                          {item.total_value ? formatRupiah(item.total_value) : "-"}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {item.rating ? (
                            <span
                              className={`inline-flex items-center justify-center gap-1 font-medium ${ratingTone(item.rating)}`}
                            >
                              <StarIcon className="h-4 w-4 fill-current" />
                              {item.rating.toFixed(1)}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
              Ranking berdasarkan total nilai PO · Total spend: {formatRupiah(totalValue)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
