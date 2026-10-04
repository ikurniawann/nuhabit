"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRupiah, formatRupiahCompact } from "@/lib/format";
import { PO_DETAIL_CSV_HEADERS, poDetailCsvRows, poStatusBreakdown } from "@/lib/purchasing/report-ui-po";
import { dateStamp, downloadCsv } from "@/lib/purchasing/report-ui-shared";
import { usePoDetailReport } from "../queries";
import { useErrorToast } from "../use-error-toast";
import { PoDetailTable } from "./po-detail-table";
import { PoReportFilters, usePoReportFilters } from "./po-report-filters";
import {
  ExportButton,
  ReportBreakdownCard,
  ReportHeader,
  ReportStatCard,
  ReportTableCard,
} from "./report-ui";

export function PODetailReportPage() {
  const filters = usePoReportFilters();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reportQuery = usePoDetailReport(filters.params);
  useErrorToast(reportQuery.error, "Gagal memuat laporan Detail PO");
  const rows = reportQuery.data ?? [];
  const loading = reportQuery.isLoading || reportQuery.isFetching;

  const totalValue = rows.reduce((sum, po) => sum + (po.total || 0), 0);
  const totalItems = rows.reduce((sum, po) => sum + po.item_count, 0);

  const toggleRow = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCsv = () => {
    downloadCsv(`po-detail-${dateStamp()}.csv`, PO_DETAIL_CSV_HEADERS, poDetailCsvRows(rows));
    toast.success("CSV berhasil diexport");
  };

  return (
    <div className="space-y-6 p-6">
      <ReportHeader
        title="PO Detail"
        description="Rincian setiap PO beserta line item, qty diterima, dan nilai subtotal."
        loading={loading}
        onRefresh={() => void reportQuery.refetch()}
      >
        <ExportButton label="Export CSV" disabled={rows.length === 0} onClick={exportCsv} />
      </ReportHeader>

      <PoReportFilters filters={filters} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportStatCard title="Total PO" value={rows.length} hint="Purchase Order ditampilkan" />
        <ReportStatCard
          title="Total Nilai"
          value={formatRupiahCompact(totalValue)}
          hint="Nilai keseluruhan"
          valueClassName="text-brand-text"
        />
        <ReportStatCard
          title="Rata-rata Nilai PO"
          value={formatRupiahCompact(rows.length > 0 ? totalValue / rows.length : 0)}
          hint="Per dokumen"
        />
        <ReportStatCard title="Total Line Item" value={totalItems} hint="Baris bahan / produk" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <ReportBreakdownCard
          title="Breakdown Status"
          loading={loading}
          rows={poStatusBreakdown(rows)}
          total={totalValue}
          formatValue={formatRupiah}
        />

        <ReportTableCard
          title="Daftar Purchase Orders"
          count={rows.length}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(new Set(rows.map((po) => po.id)))}
                disabled={rows.length === 0}
              >
                Expand All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())} disabled={expanded.size === 0}>
                Collapse
              </Button>
            </div>
          }
          footer={<>Total nilai: {formatRupiah(totalValue)} · Klik baris untuk membuka line item</>}
        >
          <PoDetailTable rows={rows} loading={loading} expanded={expanded} onToggle={toggleRow} />
        </ReportTableCard>
      </div>
    </div>
  );
}
