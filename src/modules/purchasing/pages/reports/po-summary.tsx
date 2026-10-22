"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Download,
  RefreshCw,
  AlertCircle,
  FileText,
  ShoppingCart,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { formatRupiah } from "@/modules/purchasing/utils";

// ── Types ──────────────────────────────────────────────────

interface POSummaryRow {
  po_number: string;
  vendor: string;
  status: string;
  tanggal_po: string;
  total_amount: number;
  total_amount_formatted: string;
  item_count: number;
}

interface ByStatus {
  status: string;
  count: number;
  total: number;
  total_formatted: string;
}

interface ApiResponse {
  success: boolean;
  data: {
    summary: POSummaryRow[];
    by_status: ByStatus[];
    grand_total: number;
  };
}

// ── PO Status config ────────────────────────────────────────

const PO_STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-gray-100 text-gray-700",
  },
  waiting_approval: {
    label: "Menunggu Approval",
    className: "bg-amber-100 text-amber-800",
  },
  approved: {
    label: "Disetujui",
    className: "bg-blue-100 text-blue-800",
  },
  sent: {
    label: "Terkirim",
    className: "bg-indigo-100 text-indigo-800",
  },
  received: {
    label: "Diterima",
    className: "bg-green-100 text-green-800",
  },
  cancelled: {
    label: "Dibatalkan",
    className: "bg-red-100 text-red-800",
  },
};

function POStatusBadge({ status }: { status: string }) {
  const config = PO_STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(dateStr));
}

// ── Main content ────────────────────────────────────────────

function POSummaryContent() {
  const [data, setData] = useState<POSummaryRow[]>([]);
  const [byStatus, setByStatus] = useState<ByStatus[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const buildQuery = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      }
      return params.toString();
    },
    [dateFrom, dateTo, statusFilter]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery();
      const res = await fetch(
        `/api/purchasing/reports/po-summary${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json: ApiResponse = await res.json();
      if (!json.success) throw new Error("Gagal memuat data");
      setData(json.data.summary ?? []);
      setByStatus(json.data.by_status ?? []);
      setGrandTotal(json.data.grand_total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleExportCSV() {
    const qs = buildQuery({ export: "csv" });
    window.open(
      `/api/purchasing/reports/po-summary${qs ? `?${qs}` : ""}`,
      "_blank"
    );
  }

  // Filtered rows (client-side search by PO number / vendor)
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (row) =>
        row.po_number.toLowerCase().includes(q) ||
        row.vendor.toLowerCase().includes(q)
    );
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat ringkasan PO...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className="text-sm font-medium text-red-600">{error}</p>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">
                Dari Tanggal
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">
                Sampai Tanggal
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">
                Status
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {Object.entries(PO_STATUS_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      {cfg.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button onClick={fetchData}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Terapkan
              </Button>
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grand total + by-status breakdown */}
      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">
              Grand Total Pembelian
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">
              {formatRupiah(grandTotal)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {data.length} PO ditemukan
            </p>
          </CardContent>
        </Card>

        {byStatus.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {byStatus.map((s) => {
              const cfg = PO_STATUS_CONFIG[s.status];
              return (
                <Card key={s.status} size="sm">
                  <CardHeader>
                    <CardTitle className="text-xs font-medium text-gray-500">
                      {cfg?.label ?? s.status}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-bold text-gray-900">
                      {s.count}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.total_formatted ?? formatRupiah(s.total)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Search within results */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Cari No PO atau supplier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ShoppingCart className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">Tidak ada data ditemukan</p>
              <p className="text-xs mt-1">
                Coba ubah filter tanggal atau status
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tanggal PO</TableHead>
                  <TableHead className="text-right">Jumlah Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.po_number}>
                    <TableCell className="font-mono text-xs font-medium text-gray-700">
                      {row.po_number}
                    </TableCell>
                    <TableCell>{row.vendor}</TableCell>
                    <TableCell>
                      <POStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {formatDate(row.tanggal_po)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.item_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {row.total_amount_formatted ?? formatRupiah(row.total_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Menampilkan {filtered.length} dari {data.length} PO
      </p>
    </div>
  );
}

export default function POSummaryPage() {
  return (
    <PurchasingGuard
      allowedRoles={[
        "purchasing_staff",
        "purchasing_manager",
        "purchasing_admin",
        "super_admin",
        "viewer",
      ]}
    >
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Laporan", href: "/dashboard/purchasing/reports" },
            { label: "Ringkasan PO" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Ringkasan Purchase Order
            </h1>
            <p className="text-sm text-gray-500">
              Ringkasan PO per periode dan status
            </p>
          </div>
          <Link href="/dashboard/purchasing/reports">
            <Button variant="ghost">
              <FileText className="w-4 h-4 mr-2" />
              Kembali
            </Button>
          </Link>
        </div>

        <POSummaryContent />
      </div>
    </PurchasingGuard>
  );
}
