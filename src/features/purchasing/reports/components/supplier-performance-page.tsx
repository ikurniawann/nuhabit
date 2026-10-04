"use client";

import { useState } from "react";
import { toast } from "sonner";
import { StarIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { formatRupiah, formatRupiahCompact } from "@/lib/format";
import { dateStamp, downloadCsv, formatPct } from "@/lib/purchasing/report-ui-shared";
import {
  SUPPLIER_CSV_HEADERS,
  ratingTone,
  summarizeSupplierPerformance,
  supplierCsvRows,
  topSpendSuppliers,
} from "@/lib/purchasing/report-ui-supplier";
import { useSupplierFilterOptions, useSupplierPerformance } from "../queries";
import { useErrorToast } from "../use-error-toast";
import {
  DateFilterField,
  ExportButton,
  ReportBreakdownCard,
  ReportFilterField,
  ReportHeader,
  ReportStatCard,
  ReportTableCard,
  ReportTableMessage,
} from "./report-ui";

export function SupplierPerformancePage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supplierId, setSupplierId] = useState("all");
  const supplierOptions = useSupplierFilterOptions();

  const performanceQuery = useSupplierPerformance({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    supplier_id: supplierId === "all" ? undefined : supplierId,
  });
  useErrorToast(performanceQuery.error, "Gagal memuat data performa supplier");
  const items = performanceQuery.data ?? [];
  const loading = performanceQuery.isLoading || performanceQuery.isFetching;
  const totals = summarizeSupplierPerformance(items);

  const exportCsv = () => {
    downloadCsv(`supplier-performance-${dateStamp()}.csv`, SUPPLIER_CSV_HEADERS, supplierCsvRows(items));
    toast.success("CSV berhasil diexport");
  };

  return (
    <div className="space-y-6 p-6">
      <ReportHeader
        title="Supplier Performance"
        description="Evaluasi supplier berdasarkan ketepatan pengiriman, reject rate, lead time, dan nilai transaksi."
        loading={loading}
        onRefresh={() => void performanceQuery.refetch()}
      >
        <ExportButton label="Export CSV" disabled={items.length === 0} onClick={exportCsv} />
      </ReportHeader>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <DateFilterField label="Dari Tanggal" value={dateFrom} onChange={setDateFrom} />
            <DateFilterField label="Sampai Tanggal" value={dateTo} onChange={setDateTo} />
            <ReportFilterField label="Supplier">
              <Combobox
                options={supplierOptions}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Semua Supplier"
                searchPlaceholder="Cari supplier..."
                emptyMessage="Supplier tidak ditemukan"
                className="h-10"
              />
            </ReportFilterField>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard title="Supplier Aktif" value={items.length} hint={`${totals.totalPo} PO dalam filter`} />
        <ReportStatCard
          title="Total Spend"
          value={formatRupiahCompact(totals.totalValue)}
          hint="Nilai keseluruhan PO"
          valueClassName="text-brand-text"
        />
        <ReportStatCard
          title="Rata-rata On-Time"
          value={formatPct(totals.avgOnTime)}
          hint="Dari delivery / GRN bertanggal"
          valueClassName="text-emerald-600"
        />
        <ReportStatCard
          title="Rata-rata Reject"
          value={formatPct(totals.avgReject)}
          hint="Dari QC / qty GRN"
          valueClassName={totals.avgReject > 5 ? "text-red-600" : "text-foreground"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <ReportBreakdownCard
          title="Top Spend"
          loading={loading}
          rows={topSpendSuppliers(items).map((item) => ({
            key: item.id,
            label: item.supplier_name || "-",
            caption: `${item.total_po || 0} PO · Rating ${item.rating?.toFixed(1) || "-"}`,
            value: item.total_value || 0,
          }))}
          total={totals.totalValue}
          formatValue={formatRupiah}
        />

        <ReportTableCard
          title="Ranking Supplier"
          count={items.length}
          footer={<>Ranking berdasarkan total nilai PO · Total spend: {formatRupiah(totals.totalValue)}</>}
        >
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
                <ReportTableMessage colSpan={10}>Memuat data...</ReportTableMessage>
              ) : items.length === 0 ? (
                <ReportTableMessage colSpan={10}>Belum ada data performa supplier untuk filter ini</ReportTableMessage>
              ) : (
                items.map((item) => (
                  <tr key={item.id || item.supplier_name} className="border-t border-gray-200/70 hover:bg-muted/30">
                    <td className="px-3 py-3 text-muted-foreground">{item.rank || "-"}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{item.supplier_name || "-"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.supplier_code || "-"}
                        {item.contact_person ? ` · ${item.contact_person}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-foreground">{item.total_po || 0}</td>
                    <td className="px-3 py-3 text-right text-emerald-600">{item.on_time_count || 0}</td>
                    <td className="px-3 py-3 text-right text-red-600">{item.late_count || 0}</td>
                    <td className="px-3 py-3 text-right text-muted-foreground">{formatPct(item.on_time_rate)}</td>
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
                          {formatPct(item.reject_rate)}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground">
                      {item.avg_lead_time_days != null ? `${item.avg_lead_time_days.toFixed(1)} hr` : "-"}
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
        </ReportTableCard>
      </div>
    </div>
  );
}
