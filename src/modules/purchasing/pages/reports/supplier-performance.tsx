"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Download,
  RefreshCw,
  AlertCircle,
  FileText,
  Users,
  TrendingUp,
  Medal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { formatRupiah } from "@/modules/purchasing/utils";

// ── Types ──────────────────────────────────────────────────

interface VendorPerformance {
  rank: number;
  vendor_name: string;
  total_po: number;
  approved_po: number;
  total_spent: number;
  total_spent_formatted: string;
  on_time_delivery_rate: number | null;
  reject_rate: number | null;
  quality_score: number | null;
}

interface ApiResponse {
  success: boolean;
  data: {
    summary: {
      total_vendors: number;
      total_spend_all_vendors: number;
    };
    vendors: VendorPerformance[];
  };
}

// ── Quality score badge ─────────────────────────────────────

function QualityScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-gray-400 text-sm">—</span>;
  }
  let className = "";
  if (score >= 80) {
    className = "bg-green-100 text-green-800";
  } else if (score >= 60) {
    className = "bg-amber-100 text-amber-800";
  } else {
    className = "bg-red-100 text-red-800";
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {score.toFixed(1)}
    </span>
  );
}

function formatRate(rate: number | null): string {
  if (rate === null || rate === undefined) return "—";
  return `${rate.toFixed(1)}%`;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 font-bold text-sm">
        <Medal className="w-4 h-4" /> 1
      </span>
    );
  if (rank === 2)
    return (
      <span className="text-gray-500 font-semibold text-sm">#{rank}</span>
    );
  if (rank === 3)
    return (
      <span className="text-orange-500 font-semibold text-sm">#{rank}</span>
    );
  return <span className="text-gray-500 text-sm">#{rank}</span>;
}

// ── Main content ────────────────────────────────────────────

function SupplierPerformanceContent() {
  const [vendors, setVendors] = useState<VendorPerformance[]>([]);
  const [totalVendors, setTotalVendors] = useState(0);
  const [totalSpend, setTotalSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const buildQuery = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      }
      return params.toString();
    },
    [dateFrom, dateTo]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQuery();
      const res = await fetch(
        `/api/purchasing/reports/supplier-performance${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json: ApiResponse = await res.json();
      if (!json.success) throw new Error("Gagal memuat data");
      setVendors(json.data.vendors ?? []);
      setTotalVendors(json.data.summary?.total_vendors ?? 0);
      setTotalSpend(json.data.summary?.total_spend_all_vendors ?? 0);
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
      `/api/purchasing/reports/supplier-performance${qs ? `?${qs}` : ""}`,
      "_blank"
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat data performa supplier...</p>
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Total Vendor Aktif
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">
              {totalVendors.toLocaleString("id-ID")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Total Belanja Semua Vendor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">
              {formatRupiah(totalSpend)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {vendors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Users className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">Belum ada data supplier</p>
              <p className="text-xs mt-1">
                Coba ubah rentang tanggal filter
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Nama Supplier</TableHead>
                  <TableHead className="text-right">Total PO</TableHead>
                  <TableHead className="text-right">PO Selesai</TableHead>
                  <TableHead className="text-right">Total Belanja</TableHead>
                  <TableHead className="text-right">On-Time %</TableHead>
                  <TableHead className="text-right">Reject %</TableHead>
                  <TableHead className="text-center">Skor Kualitas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.vendor_name}>
                    <TableCell>
                      <RankBadge rank={v.rank} />
                    </TableCell>
                    <TableCell className="font-medium">{v.vendor_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.total_po}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.approved_po}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {v.total_spent_formatted ?? formatRupiah(v.total_spent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(v.on_time_delivery_rate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(v.reject_rate)}
                    </TableCell>
                    <TableCell className="text-center">
                      <QualityScoreBadge score={v.quality_score} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Menampilkan {vendors.length} supplier
      </p>
    </div>
  );
}

export default function SupplierPerformancePage() {
  return (
    <PurchasingGuard
      allowedRoles={[
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
            { label: "Performa Supplier" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Performa Supplier
            </h1>
            <p className="text-sm text-gray-500">
              Evaluasi supplier berdasarkan on-time delivery &amp; kualitas
            </p>
          </div>
          <Link href="/dashboard/purchasing/reports">
            <Button variant="ghost">
              <FileText className="w-4 h-4 mr-2" />
              Kembali
            </Button>
          </Link>
        </div>

        <SupplierPerformanceContent />
      </div>
    </PurchasingGuard>
  );
}
