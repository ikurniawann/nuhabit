"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useStockCard } from "../queries";
import type {
  StockCardItemType,
  StockMovement,
  StockMovementType as MovementType,
} from "../types";

const TYPE_LABELS: Record<MovementType, string> = {
  all: "Semua Tipe",
  in: "Masuk",
  out: "Keluar",
  adjustment: "Adjustment",
  transfer: "Transfer",
  return: "Retur",
};

const TYPE_STYLES: Record<Exclude<MovementType, "all">, string> = {
  in: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  out: "border-red-200/80 bg-red-50 text-red-700",
  adjustment: "border-amber-200/80 bg-amber-50 text-amber-700",
  transfer: "border-sky-200/80 bg-sky-50 text-sky-700",
  return: "border-violet-200/80 bg-violet-50 text-violet-700",
};

function formatNumber(value: unknown) {
  const numeric = Number(value);
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(
    Number.isFinite(numeric) ? numeric : 0
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function movementDelta(movement: StockMovement) {
  const diff = movement.qty_after - movement.qty_before;
  if (diff === 0) return movement.tipe === "out" ? -movement.jumlah : movement.jumlah;
  return diff;
}

export function StockCardPage() {
  const [itemType, setItemType] = useState<StockCardItemType>("raw_material");
  const [selectedItem, setSelectedItem] = useState("all");
  const [warehouseId, setWarehouseId] = useState("all");
  const [movementType, setMovementType] = useState<MovementType>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [urlFilterReady, setUrlFilterReady] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const materialId = params.get("material_id");
    const productId = params.get("product_id");
    const type = params.get("item_type");
    const stall = params.get("warehouse_id");
    if (type === "product" || productId) setItemType("product");
    if (materialId) {
      setItemType("raw_material");
      setSelectedItem(materialId);
    }
    if (productId) {
      setItemType("product");
      setSelectedItem(productId);
    }
    if (stall) setWarehouseId(stall);
    setUrlFilterReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingWarehouses(true);
    listStockWarehouses()
      .then((rows) => {
        if (!cancelled) setWarehouses(rows);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) toast.error("Gagal memuat daftar stall");
      })
      .finally(() => {
        if (!cancelled) setLoadingWarehouses(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedItem("all");
  }, [itemType]);

  const stockCardQuery = useStockCard(
    {
      item_type: itemType,
      item_id: selectedItem !== "all" ? selectedItem : undefined,
      warehouse_id: warehouseId !== "all" ? warehouseId : undefined,
      tipe: movementType !== "all" ? movementType : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 500,
    },
    urlFilterReady
  );
  const data = stockCardQuery.data ?? null;
  const loading = !urlFilterReady || stockCardQuery.isLoading || stockCardQuery.isFetching;

  useEffect(() => {
    if (stockCardQuery.isError) {
      console.error("Error loading stock card:", stockCardQuery.error);
      toast.error(
        stockCardQuery.error instanceof Error
          ? stockCardQuery.error.message
          : "Gagal memuat stock card"
      );
    }
  }, [stockCardQuery.isError, stockCardQuery.error]);

  const selectedItemData = data?.selected_item || data?.selected_material || null;
  const movements = data?.movements || [];
  const items = useMemo(
    () => data?.items || data?.materials || [],
    [data?.items, data?.materials]
  );
  const summary = data?.summary;

  const totalPositive =
    (summary?.total_in || 0) + (summary?.total_adjustment_in || 0) + (summary?.total_return || 0);
  const totalNegative = (summary?.total_out || 0) + (summary?.total_adjustment_out || 0);
  const itemLabel = itemType === "product" ? "Produk" : "Bahan Baku";

  const itemOptions = useMemo(
    () => [
      { value: "all", label: `Semua ${itemLabel}` },
      ...items.slice(0, 500).map((item) => ({
        value: item.id,
        label: `${item.kode} - ${item.nama}`,
        description: item.kategori || undefined,
      })),
    ],
    [items, itemLabel]
  );

  const stallOptions = useMemo(
    () => [
      { value: "all", label: STALL_LABELS.allBranchTotal },
      ...warehouses.map((w) => ({
        value: w.id,
        label: w.name,
        description: w.code,
      })),
    ],
    [warehouses]
  );

  const movementTypeOptions = useMemo(
    () =>
      Object.entries(TYPE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    []
  );

  const handleExportCSV = () => {
    setExporting(true);
    try {
      const headers = [
        "Tanggal",
        "Kode Item",
        "Nama Item",
        "Tipe",
        "Ref",
        "Alasan",
        "Qty Before",
        "Mutasi",
        "Qty After",
        "Unit Cost",
        "Total Cost",
        "Catatan",
      ];
      const rows = movements.map((movement) => [
        formatDate(movement.created_at),
        movement.item_kode || movement.material_kode,
        movement.item_nama || movement.material_nama,
        TYPE_LABELS[movement.tipe],
        movement.reference_number,
        movement.alasan,
        String(movement.qty_before),
        String(movementDelta(movement)),
        String(movement.qty_after),
        String(movement.unit_cost),
        String(movement.total_cost),
        movement.catatan,
      ]);

      const csv = [
        headers.map((header) => `"${header}"`).join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock-card-${itemType}-${selectedItemData?.kode || "all"}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Stock card berhasil diexport");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Card</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kartu stok bahan baku & produk — saldo awal, mutasi, dan saldo akhir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => stockCardQuery.refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || movements.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting ? "Exporting..." : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-xs">
        <CardContent className="space-y-4 pt-4">
          <div className="inline-flex rounded-lg border border-gray-200/70 bg-muted/40 p-1">
            <Button
              type="button"
              size="sm"
              variant={itemType === "raw_material" ? "default" : "ghost"}
              className="h-8"
              onClick={() => setItemType("raw_material")}
            >
              Bahan Baku
            </Button>
            <Button
              type="button"
              size="sm"
              variant={itemType === "product" ? "default" : "ghost"}
              className="h-8"
              onClick={() => setItemType("product")}
            >
              Produk
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs">{STALL_LABELS.singular}</Label>
              <Combobox
                options={stallOptions}
                value={warehouseId}
                onChange={setWarehouseId}
                placeholder={loadingWarehouses ? STALL_LABELS.loading : STALL_LABELS.allBranchTotal}
                searchPlaceholder={STALL_LABELS.search}
                emptyMessage={STALL_LABELS.empty}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5 md:col-span-1 xl:col-span-1">
              <Label className="text-xs">{itemLabel}</Label>
              <Combobox
                options={itemOptions}
                value={selectedItem}
                onChange={setSelectedItem}
                placeholder={`Pilih ${itemLabel.toLowerCase()}...`}
                searchPlaceholder={`Cari ${itemLabel.toLowerCase()}...`}
                emptyMessage={`${itemLabel} tidak ditemukan`}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tipe Mutasi</Label>
              <Combobox
                options={movementTypeOptions}
                value={movementType}
                onChange={(value) => setMovementType(value as MovementType)}
                placeholder="Semua Tipe"
                searchPlaceholder="Cari tipe..."
                emptyMessage="Tipe tidak ditemukan"
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Dari Tanggal</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sampai Tanggal</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="h-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedItemData ? (
        <Card className="border-border shadow-xs">
          <CardContent className="grid gap-4 p-4 md:grid-cols-4">
            <div className="md:col-span-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {itemLabel} Terpilih
              </p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">{selectedItemData.nama}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedItemData.kode} · {selectedItemData.kategori}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stok Saat Ini</p>
              <p className="mt-1 text-xl font-bold text-foreground">
                {formatNumber(selectedItemData.qty_onhand)}
                {selectedItemData.satuan ? (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {selectedItemData.satuan}
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Cost</p>
              <p className="mt-1 text-xl font-bold text-foreground">
                {formatRupiah(selectedItemData.avg_cost)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Lokasi / Stall</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {selectedItemData.warehouse_name || selectedItemData.lokasi_rak || "-"}
              </p>
              <Badge className="mt-2 border-border bg-muted/50 text-muted-foreground">
                {selectedItemData.status_stok}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Awal</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">
              {formatNumber(summary?.opening_balance)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Masuk</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">{formatNumber(totalPositive)}</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Keluar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{formatNumber(totalNegative)}</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Akhir</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">
              {formatNumber(summary?.closing_balance)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Jumlah Mutasi</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{summary?.movement_count || 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b border-gray-200/70 pb-3">
          <CardTitle className="text-base">Riwayat Mutasi</CardTitle>
          <Badge variant="secondary" className="border-border bg-muted/50 text-muted-foreground">
            {movements.length} baris
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Tanggal</th>
                  <th className="px-3 py-3">Item</th>
                  <th className="px-3 py-3">Tipe</th>
                  <th className="px-3 py-3">Referensi</th>
                  <th className="px-3 py-3">Alasan</th>
                  <th className="px-3 py-3 text-right">Before</th>
                  <th className="px-3 py-3 text-right">Mutasi</th>
                  <th className="px-3 py-3 text-right">After</th>
                  <th className="px-3 py-3 text-right">Unit Cost</th>
                  <th className="px-3 py-3 text-right">Nilai</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                      Memuat stock card...
                    </td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                      {itemType === "product"
                        ? "Belum ada mutasi produk untuk filter ini. Mutasi tercatat mulai produksi/opname/adjustment berikutnya."
                        : "Belum ada mutasi untuk filter ini."}
                    </td>
                  </tr>
                ) : (
                  movements.map((movement) => {
                    const delta = movementDelta(movement);
                    return (
                      <tr key={movement.id} className="hover:bg-muted/40">
                        <td className="whitespace-nowrap px-3 py-3 text-foreground">
                          {formatDate(movement.created_at)}
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-foreground">
                            {movement.item_nama || movement.material_nama}
                          </p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {movement.item_kode || movement.material_kode}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge className={TYPE_STYLES[movement.tipe]}>
                            {TYPE_LABELS[movement.tipe]}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-foreground">{movement.reference_number}</p>
                          <p className="text-xs text-muted-foreground">{movement.reference_type}</p>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{movement.alasan}</td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {formatNumber(movement.qty_before)}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${
                            delta < 0 ? "text-red-600" : "text-emerald-600"
                          }`}
                        >
                          {delta > 0 ? "+" : ""}
                          {formatNumber(delta)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-foreground">
                          {formatNumber(movement.qty_after)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {formatRupiah(movement.unit_cost)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-primary">
                          {formatRupiah(movement.total_cost)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
            Menampilkan {movements.length} mutasi
            {selectedItemData ? ` untuk ${selectedItemData.nama}` : ""}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
