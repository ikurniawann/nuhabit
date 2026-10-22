"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah } from "@/lib/purchasing/utils";
import { useSupplierList } from "@/features/purchasing/suppliers/queries";
import { usePoDetailReport } from "../queries";

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

interface POLineItem {
  id: string;
  nama_bahan: string;
  kode_bahan?: string;
  qty_order: number;
  qty_received: number;
  harga_satuan: number;
  satuan?: string;
  subtotal: number;
}

interface PODetail {
  id: string;
  no_po: string;
  tanggal_po: string;
  supplier: string;
  vendor_code?: string;
  supplier_id?: string;
  status: string;
  total: number;
  item_count: number;
  items: POLineItem[];
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateStr));
}

function formatQty(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(value);
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

export function PODetailReportPage() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [vendorId, setVendorId] = useState("all");
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

  const reportQuery = usePoDetailReport({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    vendor_id: vendorId === "all" ? undefined : vendorId,
  });
  const loading = reportQuery.isLoading || reportQuery.isFetching;

  const poList = useMemo<PODetail[]>(
    () =>
      ((reportQuery.data ?? []) as Record<string, any>[]).map((po) => ({
        id: po.id || po.po_number,
        no_po: po.po_number,
        tanggal_po: po.tanggal_po,
        supplier: po.vendor,
        vendor_code: po.vendor_code,
        supplier_id: po.supplier_id,
        status: String(po.status || "").toLowerCase(),
        total: Number(po.total_amount || 0),
        item_count: Number(po.item_count || po.items?.length || 0),
        items: (po.items || []).map((item: Record<string, any>) => ({
          id: item.id || item.bahan_baku_id || `${po.po_number}-${item.kode_bahan}`,
          nama_bahan: item.nama_bahan || item.nama || "-",
          kode_bahan: item.kode_bahan || item.kode,
          qty_order: Number(item.qty_order || item.quantity || 0),
          qty_received: Number(item.qty_received || 0),
          harga_satuan: Number(item.harga_satuan || item.unit_price || 0),
          satuan: item.satuan,
          subtotal: Number(
            item.subtotal ||
              Number(item.qty_order || 0) * Number(item.harga_satuan || 0)
          ),
        })),
      })),
    [reportQuery.data]
  );

  useEffect(() => {
    if (reportQuery.isError) {
      console.error("Error loading PO detail report:", reportQuery.error);
      toast.error(
        reportQuery.error instanceof Error
          ? reportQuery.error.message
          : "Gagal memuat laporan Detail PO"
      );
    }
  }, [reportQuery.isError, reportQuery.error]);

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedRows(new Set(poList.map((po) => po.id)));
  };

  const collapseAll = () => {
    setExpandedRows(new Set());
  };

  const handleExportCSV = () => {
    setExporting(true);
    try {
      const headerRow = [
        "No PO",
        "Tanggal",
        "Supplier",
        "Status",
        "Nama Bahan",
        "Kode Bahan",
        "Qty Order",
        "Qty Diterima",
        "Harga Satuan",
        "Subtotal",
        "Total PO",
      ];
      const rows: string[][] = [];

      for (const po of poList) {
        if (po.items.length === 0) {
          rows.push([
            po.no_po,
            formatDate(po.tanggal_po),
            po.supplier,
            po.status,
            "-",
            "-",
            "",
            "",
            "",
            "",
            String(po.total),
          ]);
        } else {
          po.items.forEach((item, idx) => {
            rows.push([
              idx === 0 ? po.no_po : "",
              idx === 0 ? formatDate(po.tanggal_po) : "",
              idx === 0 ? po.supplier : "",
              idx === 0 ? po.status : "",
              item.nama_bahan,
              item.kode_bahan || "",
              String(item.qty_order),
              String(item.qty_received),
              String(item.harga_satuan),
              String(item.subtotal),
              idx === 0 ? String(po.total) : "",
            ]);
          });
        }
      }

      const csvContent = [
        headerRow.map((h) => `"${h}"`).join(","),
        ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `po-detail-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV berhasil diexport");
    } finally {
      setExporting(false);
    }
  };

  const totalPO = poList.length;
  const totalValue = poList.reduce((sum, po) => sum + (po.total || 0), 0);
  const totalItems = poList.reduce((sum, po) => sum + po.item_count, 0);
  const avgValue = totalPO > 0 ? totalValue / totalPO : 0;

  const statusEntries = useMemo(() => {
    const map = poList.reduce<Record<string, { count: number; total: number }>>((acc, po) => {
      if (!acc[po.status]) acc[po.status] = { count: 0, total: 0 };
      acc[po.status].count += 1;
      acc[po.status].total += po.total || 0;
      return acc;
    }, {});
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [poList]);

  const maxStatusTotal =
    statusEntries.length > 0 ? Math.max(...statusEntries.map(([, v]) => v.total), 1) : 1;

  return (
    <div className="space-y-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PO Detail</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rincian setiap PO beserta line item, qty diterima, dan nilai subtotal.
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
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={exporting || poList.length === 0}
          >
            <DocumentArrowDownIcon className="mr-1 h-4 w-4" />
            {exporting ? "Exporting..." : "Export CSV"}
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
            <p className="text-2xl font-bold text-foreground">{totalPO}</p>
            <p className="mt-1 text-xs text-muted-foreground">Purchase Order ditampilkan</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Nilai</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatRupiah(totalValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Nilai keseluruhan</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rata-rata Nilai PO
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{formatRupiah(avgValue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Per dokumen</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Line Item</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{totalItems}</p>
            <p className="mt-1 text-xs text-muted-foreground">Baris bahan / produk</p>
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
            ) : statusEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data</p>
            ) : (
              statusEntries.map(([status, { count, total }]) => {
                const pct = totalValue > 0 ? (total / totalValue) * 100 : 0;
                const barPct = maxStatusTotal > 0 ? (total / maxStatusTotal) * 100 : 0;
                return (
                  <div key={status} className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {STATUS_LABELS[status] || status}
                        </p>
                        <p className="text-xs text-muted-foreground">{count} PO</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">
                          {formatRupiah(total)}
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-gray-200/70 pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Daftar Purchase Orders</CardTitle>
              <Badge
                variant="secondary"
                className="border-border bg-muted/50 text-muted-foreground"
              >
                {poList.length} baris
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={expandAll} disabled={poList.length === 0}>
                Expand All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={collapseAll}
                disabled={expandedRows.size === 0}
              >
                Collapse
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-220 text-sm">
                <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-3" />
                    <th className="px-3 py-3">No PO</th>
                    <th className="px-3 py-3">Tanggal</th>
                    <th className="px-3 py-3">Supplier</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Items</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-3 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                        Memuat data...
                      </td>
                    </tr>
                  ) : poList.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                        Tidak ada data PO untuk filter ini
                      </td>
                    </tr>
                  ) : (
                    poList.map((po) => {
                      const expanded = expandedRows.has(po.id);
                      return (
                        <Fragment key={po.id}>
                          <tr
                            className="cursor-pointer border-t border-gray-200/70 hover:bg-muted/30"
                            onClick={() => toggleRow(po.id)}
                          >
                            <td className="px-3 py-3 text-muted-foreground">
                              {expanded ? (
                                <ChevronDownIcon className="h-4 w-4" />
                              ) : (
                                <ChevronRightIcon className="h-4 w-4" />
                              )}
                            </td>
                            <td className="px-3 py-3 font-medium text-primary">{po.no_po}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {formatDate(po.tanggal_po)}
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-foreground">{po.supplier}</div>
                              {po.vendor_code ? (
                                <div className="text-xs text-muted-foreground">{po.vendor_code}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={po.status} />
                            </td>
                            <td className="px-3 py-3 text-right text-muted-foreground">
                              {po.item_count}
                            </td>
                            <td className="px-3 py-3 text-right font-medium text-foreground">
                              {formatRupiah(po.total)}
                            </td>
                            <td
                              className="px-3 py-3 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Link href={`/dashboard/purchasing/po/${po.id}`}>
                                <Button variant="outline" size="sm" className="h-8">
                                  Detail
                                </Button>
                              </Link>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-t border-gray-200/70 bg-muted/20">
                              <td colSpan={8} className="px-6 py-4">
                                {po.items.length === 0 ? (
                                  <p className="text-xs italic text-muted-foreground">
                                    Tidak ada line item
                                  </p>
                                ) : (
                                  <div className="overflow-x-auto rounded-lg border border-gray-200/70 bg-card">
                                    <table className="w-full text-xs">
                                      <thead className="bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        <tr>
                                          <th className="px-3 py-2">Item</th>
                                          <th className="px-3 py-2">Kode</th>
                                          <th className="px-3 py-2 text-right">Qty Order</th>
                                          <th className="px-3 py-2 text-right">Qty Diterima</th>
                                          <th className="px-3 py-2 text-right">Harga Satuan</th>
                                          <th className="px-3 py-2 text-right">Subtotal</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {po.items.map((item) => {
                                          const incomplete = item.qty_received < item.qty_order;
                                          return (
                                            <tr
                                              key={item.id}
                                              className="border-t border-gray-200/70"
                                            >
                                              <td className="px-3 py-2 text-foreground">
                                                {item.nama_bahan}
                                              </td>
                                              <td className="px-3 py-2 font-mono text-muted-foreground">
                                                {item.kode_bahan || "-"}
                                              </td>
                                              <td className="px-3 py-2 text-right text-muted-foreground">
                                                {formatQty(item.qty_order)}
                                                {item.satuan ? ` ${item.satuan}` : ""}
                                              </td>
                                              <td
                                                className={`px-3 py-2 text-right font-medium ${
                                                  incomplete ? "text-amber-600" : "text-emerald-600"
                                                }`}
                                              >
                                                {formatQty(item.qty_received)}
                                              </td>
                                              <td className="px-3 py-2 text-right text-muted-foreground">
                                                {formatRupiah(item.harga_satuan)}
                                              </td>
                                              <td className="px-3 py-2 text-right font-medium text-foreground">
                                                {formatRupiah(item.subtotal)}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-200/70 px-4 py-3 text-xs text-muted-foreground">
              Total nilai: {formatRupiah(totalValue)} · Klik baris untuk membuka line item
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
