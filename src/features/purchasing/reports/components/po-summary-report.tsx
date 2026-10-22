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
import { formatRupiah } from "@/lib/purchasing/utils";
import { useSupplierList } from "@/features/purchasing/suppliers/queries";
import { usePoSummary } from "../queries";
import { exportPoSummary } from "../api";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partially Received" },
  { value: "partially_received", label: "Partially Received" },
  { value: "received", label: "Fully Received" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200/80 bg-gray-50 text-gray-700",
  pending_approval: "border-amber-200/80 bg-amber-50 text-amber-700",
  approved: "border-blue-200/80 bg-blue-50 text-blue-700",
  sent: "border-violet-200/80 bg-violet-50 text-violet-700",
  partial: "border-amber-200/80 bg-amber-50 text-amber-700",
  partially_received: "border-amber-200/80 bg-amber-50 text-amber-700",
  received: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200/80 bg-red-50 text-red-700",
  cancelled: "border-red-200/80 bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  sent: "Sent",
  partial: "Partially Received",
  partially_received: "Partially Received",
  received: "Fully Received",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateStr));
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <Badge
      variant="outline"
      className={STATUS_STYLES[key] || "border-border bg-muted/50 text-muted-foreground"}
    >
      {STATUS_LABELS[key] || status}
    </Badge>
  );
}

export function POSummaryReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorId, setVendorId] = useState("all");
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

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

  const summaryQuery = usePoSummary({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    vendor_id: vendorId === "all" ? undefined : vendorId,
  });

  const data = summaryQuery.data?.summary ?? [];
  const statusSummary = summaryQuery.data?.byStatus ?? [];
  const grandTotal = summaryQuery.data?.grandTotal ?? 0;
  const loading = summaryQuery.isLoading || summaryQuery.isFetching;

  useEffect(() => {
    if (summaryQuery.isError) {
      console.error("Error loading report:", summaryQuery.error);
      toast.error(
        summaryQuery.error instanceof Error
          ? summaryQuery.error.message
          : "Gagal memuat laporan PO Summary"
      );
    }
  }, [summaryQuery.isError, summaryQuery.error]);

  const approved = statusSummary.find((s) => s.status === "approved");
  const received = statusSummary.find(
    (s) => s.status === "received" || s.status === "partially_received" || s.status === "partial"
  );
  const receivedCount = statusSummary
    .filter((s) => ["received", "partially_received", "partial"].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);
  const receivedTotal = statusSummary
    .filter((s) => ["received", "partially_received", "partial"].includes(s.status))
    .reduce((sum, s) => sum + s.total, 0);

  const maxStatusTotal =
    statusSummary.length > 0 ? Math.max(...statusSummary.map((s) => s.total), 1) : 1;

  const handleExport = async (format: "csv" | "json") => {
    setExporting(format);
    try {
      const { blob, extension } = await exportPoSummary(
        {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          vendor_id: vendorId === "all" ? undefined : vendorId,
        },
        format
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `po-summary-${new Date().toISOString().split("T")[0]}.${extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(`${extension.toUpperCase()} berhasil diexport`);
    } catch (error) {
      console.error("Error exporting:", error);
      toast.error(error instanceof Error ? error.message : "Gagal export laporan");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PO Summary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rekapitulasi PO per periode, supplier, dan status beserta nilai total.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => summaryQuery.refetch()}
            disabled={loading}
          >
            <ArrowPathIcon className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("csv")}
            disabled={!!exporting || data.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting === "csv" ? "Exporting..." : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("json")}
            disabled={!!exporting || data.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting === "json" ? "Exporting..." : "Export JSON"}
          </Button>
        </div>
      </div>

      <Card className="border-border shadow-xs">
        <CardContent className="pt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              <Label className="text-xs">Supplier</Label>
              <Combobox
                options={supplierOptions}
                value={vendorId}
                onChange={setVendorId}
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
            <CardTitle className="text-sm font-medium text-muted-foreground">Total PO</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{data.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Purchase Order ditampilkan</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Grand Total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatRupiah(grandTotal)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Nilai keseluruhan</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">{approved?.count || 0}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRupiah(approved?.total || 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Received</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">
              {receivedCount || received?.count || 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRupiah(receivedTotal || received?.total || 0)}
            </p>
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
            ) : statusSummary.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
            ) : (
              statusSummary.map((item) => {
                const pct = grandTotal > 0 ? (item.total / grandTotal) * 100 : 0;
                const barPct = maxStatusTotal > 0 ? (item.total / maxStatusTotal) * 100 : 0;
                return (
                  <div key={item.status} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {STATUS_LABELS[item.status] || item.status}
                        </p>
                        <p className="text-xs text-muted-foreground">{item.count} PO</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {formatRupiah(item.total)}
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
            <CardTitle className="text-base">Detail Purchase Orders</CardTitle>
            <Badge
              variant="secondary"
              className="border-border bg-muted/50 text-muted-foreground"
            >
              {data.length} baris
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto px-4">
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
                    <tr>
                      <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                        Memuat data...
                      </td>
                    </tr>
                  ) : data.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                        Tidak ada data PO untuk filter ini
                      </td>
                    </tr>
                  ) : (
                    data.map((po) => (
                      <tr
                        key={po.po_number}
                        className="border-t border-gray-200/70 hover:bg-muted/30"
                      >
                        <td className="px-3 py-3 font-medium text-foreground">{po.po_number}</td>
                        <td className="px-3 py-3">
                          <div className="text-foreground">{po.vendor}</div>
                          {po.vendor_code ? (
                            <div className="text-xs text-muted-foreground">{po.vendor_code}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={po.status} />
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDate(po.tanggal_po)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {po.item_count}
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-foreground">
                          {po.total_amount_formatted}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{po.created_by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
              Total nilai: {formatRupiah(grandTotal)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
