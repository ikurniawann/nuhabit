"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CubeIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { formatNumber, formatRupiah, formatRupiahCompact } from "@/lib/format";
import {
  INVENTORY_CSV_HEADERS,
  STOCK_STATUS_LABELS,
  filterInventory,
  inventoryCategories,
  inventoryCategoryBreakdown,
  inventoryCsvRows,
  inventoryValue,
  summarizeInventory,
  toInventoryRow,
  type StockStatus,
} from "@/lib/purchasing/report-ui-inventory";
import { dateStamp, downloadCsv } from "@/lib/purchasing/report-ui-shared";
import { useInventoryValuation } from "../queries";
import { useErrorToast } from "../use-error-toast";
import {
  ExportButton,
  ReportBreakdownCard,
  ReportFilterField,
  ReportHeader,
  ReportStatCard,
  ReportTableCard,
  ReportTableMessage,
} from "./report-ui";

const STATUS_STYLES: Record<StockStatus, string> = {
  normal: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200/80 bg-amber-50 text-amber-700",
  critical: "border-orange-200/80 bg-orange-50 text-orange-700",
  empty: "border-red-200/80 bg-red-50 text-red-700",
};

export function InventoryValuationPage() {
  const [search, setSearch] = useState("");
  const [kategori, setKategori] = useState("all");

  const valuationQuery = useInventoryValuation({});
  useErrorToast(valuationQuery.error, "Gagal memuat data valuasi inventori");
  const loading = valuationQuery.isLoading || valuationQuery.isFetching;

  const items = useMemo(() => (valuationQuery.data ?? []).map(toInventoryRow), [valuationQuery.data]);
  const filtered = filterInventory(items, search, kategori);
  const totals = summarizeInventory(filtered);
  const categoryOptions = [
    { value: "all", label: "Semua Kategori" },
    ...inventoryCategories(items).map((category) => ({ value: category, label: category })),
  ];

  const exportCsv = () => {
    downloadCsv(`inventory-valuation-${dateStamp()}.csv`, INVENTORY_CSV_HEADERS, inventoryCsvRows(filtered));
    toast.success("CSV berhasil diexport");
  };

  return (
    <div className="space-y-6 p-6">
      <ReportHeader
        title="Inventory Valuation"
        description="Nilai stok bahan baku berdasarkan harga rata-rata dan status ketersediaan."
        loading={loading}
        onRefresh={() => void valuationQuery.refetch()}
      >
        <ExportButton label="Export CSV" disabled={filtered.length === 0} onClick={exportCsv} />
      </ReportHeader>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <ReportFilterField label="Cari Item">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Kode atau nama bahan..."
                className="h-10"
              />
            </ReportFilterField>
            <ReportFilterField label="Kategori">
              <Combobox
                options={categoryOptions}
                value={kategori}
                onChange={setKategori}
                placeholder="Semua Kategori"
                searchPlaceholder="Cari kategori..."
                emptyMessage="Kategori tidak ditemukan"
                className="h-10"
              />
            </ReportFilterField>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard
          title="Total Nilai"
          value={formatRupiahCompact(totals.totalValue)}
          hint={`${filtered.length} item ditampilkan`}
          valueClassName="text-brand-text"
        />
        <ReportStatCard
          title="Total Qty Stok"
          value={formatNumber(totals.totalQty, 3)}
          hint="Semua satuan digabung"
        />
        <ReportStatCard
          title="Warning"
          value={totals.warningCount}
          hint="Di bawah stok minimum"
          valueClassName="text-amber-600"
        />
        <ReportStatCard
          title="Critical / Kosong"
          value={totals.criticalCount}
          hint="Perlu perhatian segera"
          valueClassName="text-red-600"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <ReportBreakdownCard
          title="Breakdown Kategori"
          loading={loading}
          rows={inventoryCategoryBreakdown(filtered)}
          total={totals.totalValue}
          formatValue={formatRupiah}
        />

        <ReportTableCard
          title="Detail Valuasi"
          count={filtered.length}
          footer={`Menampilkan ${filtered.length} dari ${items.length} item`}
        >
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
                <ReportTableMessage colSpan={8}>Memuat valuasi inventori...</ReportTableMessage>
              ) : filtered.length === 0 ? (
                <ReportTableMessage colSpan={8}>
                  <div className="flex flex-col items-center">
                    <CubeIcon className="mb-2 h-10 w-10 opacity-50" />
                    <p>Belum ada data untuk filter ini</p>
                  </div>
                </ReportTableMessage>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/40">
                    <td className="px-3 py-3">
                      <p className="font-medium text-foreground">{item.nama || "-"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.kode || "-"}</p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{item.kategori || "-"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.lokasi_rak || "-"}</td>
                    <td className="px-3 py-3 text-right font-medium text-foreground">
                      {formatNumber(item.qty_in_stock, 3)}
                      {item.satuan ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">{item.satuan}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground">
                      {formatNumber(item.minimum_stock, 3)} /{" "}
                      {item.maximum_stock != null ? formatNumber(item.maximum_stock, 3) : "-"}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground">
                      {item.avg_unit_cost ? formatRupiah(item.avg_unit_cost) : "-"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-brand-text">
                      {formatRupiah(inventoryValue(item))}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={STATUS_STYLES[item.stock_status]}>
                        {item.stock_status !== "normal" ? <ExclamationTriangleIcon className="mr-1 h-3 w-3" /> : null}
                        {STOCK_STATUS_LABELS[item.stock_status]}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ReportTableCard>
      </div>
    </div>
  );
}
