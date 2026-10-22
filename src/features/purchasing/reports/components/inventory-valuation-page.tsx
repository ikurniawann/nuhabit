"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowPathIcon,
  CubeIcon,
  DocumentArrowDownIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah } from "@/lib/purchasing/utils";
import { useInventoryValuation } from "../queries";
import type { InventoryApiRow } from "../types";

type StockStatus = "normal" | "warning" | "critical" | "empty";

const STATUS_STYLES: Record<StockStatus, string> = {
  normal: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200/80 bg-amber-50 text-amber-700",
  critical: "border-orange-200/80 bg-orange-50 text-orange-700",
  empty: "border-red-200/80 bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<StockStatus, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical",
  empty: "Kosong",
};

interface InventoryRow {
  id: string;
  kode?: string;
  nama?: string;
  kategori?: string;
  kategori_raw?: string;
  lokasi_rak?: string;
  qty_in_stock: number;
  minimum_stock?: number;
  maximum_stock?: number;
  avg_unit_cost?: number;
  stock_status: StockStatus;
  satuan?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
}

export function InventoryValuationPage() {
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState("all");
  const [exporting, setExporting] = useState(false);

  const valuationQuery = useInventoryValuation({});
  const loading = valuationQuery.isLoading || valuationQuery.isFetching;

  const items = useMemo<InventoryRow[]>(
    () =>
      (valuationQuery.data ?? []).map((item: InventoryApiRow) => {
        let stockStatus: StockStatus = "normal";
        const qty = Number(item.qty_onhand || 0);
        const minStock = Number(item.min_stock ?? item.stok_minimum ?? 0);
        if (qty === 0) stockStatus = "empty";
        else if (minStock > 0 && qty <= minStock * 0.25) stockStatus = "critical";
        else if (minStock > 0 && qty <= minStock) stockStatus = "warning";

        const rawCategory = item.kategori || "LAINNYA";
        return {
          id: item.id || item.raw_material_id || "",
          kode: item.kode,
          nama: item.nama,
          kategori: CATEGORY_LABELS[rawCategory] || rawCategory,
          kategori_raw: rawCategory,
          lokasi_rak: item.lokasi_rak,
          qty_in_stock: qty,
          minimum_stock: minStock,
          maximum_stock: item.max_stock ?? item.stok_maximum ?? undefined,
          avg_unit_cost: Number(item.avg_cost ?? item.unit_cost ?? 0),
          stock_status: stockStatus,
          satuan: item.satuan || item.satuan_besar_nama,
        };
      }),
    [valuationQuery.data]
  );

  useEffect(() => {
    if (valuationQuery.isError) {
      console.error("Error fetching inventory valuation:", valuationQuery.error);
      toast.error(
        valuationQuery.error instanceof Error
          ? valuationQuery.error.message
          : "Gagal memuat data valuasi inventori"
      );
    }
  }, [valuationQuery.isError, valuationQuery.error]);

  const categoryOptions = useMemo(() => {
    const unique = Array.from(
      new Set(items.map((item) => item.kategori).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b, "id"));
    return [
      { value: "all", label: "Semua Kategori" },
      ...unique.map((cat) => ({ value: cat, label: cat })),
    ];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchSearch =
        !q ||
        item.kode?.toLowerCase().includes(q) ||
        item.nama?.toLowerCase().includes(q);
      const matchKategori = kategori === "all" || item.kategori === kategori;
      return matchSearch && matchKategori;
    });
  }, [items, search, kategori]);

  const totalNilai = filtered.reduce(
    (sum, item) => sum + item.qty_in_stock * (item.avg_unit_cost || 0),
    0
  );
  const totalStok = filtered.reduce((sum, item) => sum + item.qty_in_stock, 0);
  const warningCount = filtered.filter((item) => item.stock_status === "warning").length;
  const criticalCount = filtered.filter(
    (item) => item.stock_status === "critical" || item.stock_status === "empty"
  ).length;

  const categoryEntries = useMemo(() => {
    const breakdown = filtered.reduce<Record<string, { count: number; nilai: number }>>(
      (acc, item) => {
        const cat = item.kategori || "Lainnya";
        if (!acc[cat]) acc[cat] = { count: 0, nilai: 0 };
        acc[cat].count += 1;
        acc[cat].nilai += item.qty_in_stock * (item.avg_unit_cost || 0);
        return acc;
      },
      {}
    );
    return Object.entries(breakdown).sort((a, b) => b[1].nilai - a[1].nilai);
  }, [filtered]);

  const maxNilai = categoryEntries.length > 0 ? Math.max(...categoryEntries.map(([, v]) => v.nilai)) : 1;

  const handleExportCSV = () => {
    setExporting(true);
    try {
      const headers = [
        "Kode",
        "Nama",
        "Kategori",
        "Lokasi",
        "Stok",
        "Satuan",
        "Min",
        "Max",
        "Unit Cost",
        "Nilai Total",
        "Status",
      ];
      const rows = filtered.map((item) => [
        item.kode || "",
        item.nama || "",
        item.kategori || "",
        item.lokasi_rak || "",
        String(item.qty_in_stock),
        item.satuan || "",
        String(item.minimum_stock ?? ""),
        String(item.maximum_stock ?? ""),
        String(item.avg_unit_cost ?? 0),
        String(item.qty_in_stock * (item.avg_unit_cost || 0)),
        STATUS_LABELS[item.stock_status],
      ]);

      const csvContent = [
        headers.map((h) => `"${h}"`).join(","),
        ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-valuation-${new Date().toISOString().split("T")[0]}.csv`;
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
          <h1 className="text-2xl font-bold text-foreground">Inventory Valuation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nilai stok bahan baku berdasarkan harga rata-rata dan status ketersediaan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => valuationQuery.refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || filtered.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div className="space-y-1.5">
              <Label className="text-xs">Cari Item</Label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Kode atau nama bahan..."
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kategori</Label>
              <Combobox
                options={categoryOptions}
                value={kategori}
                onChange={setKategori}
                placeholder="Semua Kategori"
                searchPlaceholder="Cari kategori..."
                emptyMessage="Kategori tidak ditemukan"
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
              Total Nilai
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatRupiah(totalNilai)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {filtered.length} item ditampilkan
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Qty Stok
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatQty(totalStok)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Semua satuan digabung</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Warning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{warningCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Di bawah stok minimum</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critical / Kosong
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Perlu perhatian segera</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border shadow-xs">
          <CardHeader className="border-b border-gray-200/70 pb-3">
            <CardTitle className="text-base">Breakdown Kategori</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : categoryEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
            ) : (
              categoryEntries.map(([cat, { count, nilai }]) => {
                const pct = totalNilai > 0 ? (nilai / totalNilai) * 100 : 0;
                const barPct = maxNilai > 0 ? (nilai / maxNilai) * 100 : 0;
                return (
                  <div key={cat} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{cat}</p>
                        <p className="text-xs text-muted-foreground">{count} item</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {formatRupiah(nilai)}
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
            <CardTitle className="text-base">Detail Valuasi</CardTitle>
            <Badge variant="secondary" className="border-border bg-muted/50 text-muted-foreground">
              {filtered.length} baris
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3">Item</th>
                    <th className="px-3 py-3">Kategori</th>
                    <th className="px-3 py-3">Lokasi</th>
                    <th className="px-3 py-3 text-right">Stok</th>
                    <th className="px-3 py-3 text-right">Min / Max</th>
                    <th className="px-3 py-3 text-right">Unit Cost</th>
                    <th className="px-3 py-3 text-right">Nilai</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/70">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                        Memuat valuasi inventori...
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12">
                        <div className="flex flex-col items-center text-muted-foreground">
                          <CubeIcon className="mb-2 h-10 w-10 opacity-50" />
                          <p>Belum ada data untuk filter ini</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item) => {
                      const nilai = item.qty_in_stock * (item.avg_unit_cost || 0);
                      return (
                        <tr key={item.id} className="hover:bg-muted/40">
                          <td className="px-3 py-3">
                            <p className="font-medium text-foreground">{item.nama || "-"}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {item.kode || "-"}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {item.kategori || "-"}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {item.lokasi_rak || "-"}
                          </td>
                          <td className="px-3 py-3 text-right font-medium text-foreground">
                            {formatQty(item.qty_in_stock)}
                            {item.satuan ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {item.satuan}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-right text-muted-foreground">
                            {formatQty(item.minimum_stock || 0)} /{" "}
                            {item.maximum_stock != null ? formatQty(item.maximum_stock) : "-"}
                          </td>
                          <td className="px-3 py-3 text-right text-muted-foreground">
                            {item.avg_unit_cost ? formatRupiah(item.avg_unit_cost) : "-"}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-primary">
                            {formatRupiah(nilai)}
                          </td>
                          <td className="px-3 py-3">
                            <Badge className={STATUS_STYLES[item.stock_status]}>
                              {item.stock_status === "warning" ||
                              item.stock_status === "critical" ||
                              item.stock_status === "empty" ? (
                                <ExclamationTriangleIcon className="mr-1 h-3 w-3" />
                              ) : null}
                              {STATUS_LABELS[item.stock_status]}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
              Menampilkan {filtered.length} dari {items.length} item
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
