"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatDate, formatRupiah, formatRupiahCompact } from "@/lib/format";
import { PO_STATUS_LABELS, receivedSummary } from "@/lib/purchasing/report-ui-po";
import { dateStamp, downloadBlob } from "@/lib/purchasing/report-ui-shared";
import { exportPoSummary } from "../api";
import { usePoSummary } from "../queries";
import type { PoSummaryExportFormat } from "../types";
import { useErrorToast } from "../use-error-toast";
import { PoReportFilters, usePoReportFilters } from "./po-report-filters";
import { PoStatusBadge } from "./po-status-badge";
import {
  ExportButton,
  ReportBreakdownCard,
  ReportHeader,
  ReportStatCard,
  ReportTableCard,
  ReportTableMessage,
} from "./report-ui";

export function POSummaryReport() {
  const filters = usePoReportFilters();
  const [exporting, setExporting] = useState<PoSummaryExportFormat | null>(null);

  const summaryQuery = usePoSummary(filters.params);
  useErrorToast(summaryQuery.error, "Gagal memuat laporan PO Summary");
  const rows = summaryQuery.data?.summary ?? [];
  const byStatus = summaryQuery.data?.byStatus ?? [];
  const grandTotal = summaryQuery.data?.grandTotal ?? 0;
  const loading = summaryQuery.isLoading || summaryQuery.isFetching;

  const approved = byStatus.find((row) => row.status === "approved");
  const received = receivedSummary(byStatus);

  const handleExport = async (format: PoSummaryExportFormat) => {
    setExporting(format);
    try {
      const { blob, extension } = await exportPoSummary(filters.params, format);
      downloadBlob(blob, `po-summary-${dateStamp()}.${extension}`);
      toast.success(`${extension.toUpperCase()} berhasil diexport`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export laporan");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <ReportHeader
        title="PO Summary"
        description="Rekapitulasi PO per periode, supplier, dan status beserta nilai total."
        loading={loading}
        onRefresh={() => void summaryQuery.refetch()}
      >
        {(["csv", "json"] as const).map((format) => (
          <ExportButton
            key={format}
            label={`Export ${format.toUpperCase()}`}
            busy={exporting === format}
            disabled={!!exporting || rows.length === 0}
            onClick={() => void handleExport(format)}
          />
        ))}
      </ReportHeader>

      <PoReportFilters filters={filters} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard title="Total PO" value={rows.length} hint="Purchase Order ditampilkan" />
        <ReportStatCard
          title="Grand Total"
          value={formatRupiahCompact(grandTotal)}
          hint="Nilai keseluruhan"
          valueClassName="text-brand-text"
        />
        <ReportStatCard
          title="Approved"
          value={approved?.count || 0}
          hint={formatRupiahCompact(approved?.total || 0)}
          valueClassName="text-blue-600"
        />
        <ReportStatCard
          title="Received"
          value={received.count}
          hint={formatRupiahCompact(received.total)}
          valueClassName="text-emerald-600"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <ReportBreakdownCard
          title="Breakdown Status"
          loading={loading}
          rows={byStatus.map((row) => ({
            key: row.status,
            label: PO_STATUS_LABELS[row.status] || row.status,
            caption: `${row.count} PO`,
            value: row.total,
          }))}
          total={grandTotal}
          formatValue={formatRupiah}
        />

        <ReportTableCard
          title="Detail Purchase Orders"
          count={rows.length}
          footer={<>Total nilai: {formatRupiah(grandTotal)}</>}
        >
          <table className="w-full min-w-220 text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3">PO Number</th>
                <th className="px-3 py-3">Supplier</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Tanggal PO</th>
                <th className="px-3 py-3 text-right">Items</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3">Created By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <ReportTableMessage colSpan={7}>Memuat data...</ReportTableMessage>
              ) : rows.length === 0 ? (
                <ReportTableMessage colSpan={7}>Tidak ada data PO untuk filter ini</ReportTableMessage>
              ) : (
                rows.map((po) => (
                  <tr key={po.po_number} className="border-t border-gray-200/70 hover:bg-muted/30">
                    <td className="px-3 py-3 font-medium text-foreground">{po.po_number}</td>
                    <td className="px-3 py-3">
                      <div className="text-foreground">{po.vendor}</div>
                      {po.vendor_code ? <div className="text-xs text-muted-foreground">{po.vendor_code}</div> : null}
                    </td>
                    <td className="px-3 py-3">
                      <PoStatusBadge status={po.status} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{formatDate(po.tanggal_po)}</td>
                    <td className="px-3 py-3 text-right text-muted-foreground">{po.item_count}</td>
                    <td className="px-3 py-3 text-right font-medium text-foreground">{formatRupiah(po.total_amount)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{po.created_by}</td>
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
