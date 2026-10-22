"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Package,
  Download,
  RefreshCw,
  Search,
  AlertCircle,
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
import { formatRupiah, debounce, exportToCSV } from "@/modules/purchasing/utils";

// ── Types ──────────────────────────────────────────────────

interface InventoryItem {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  qty_onhand: number;
  avg_cost: number;
  status_stok: "AMAN" | "MENIPIS" | "HABIS";
  satuan_besar: { nama: string };
}

interface CategorySummary {
  kategori: string;
  total_value: number;
  item_count: number;
}

interface Summary {
  total_value: number;
  total_items: number;
  by_category: CategorySummary[];
}

interface ApiResponse {
  success: boolean;
  data: InventoryItem[];
  summary: Summary;
}

// ── Status badge helper ────────────────────────────────────

function StockStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    AMAN: "bg-green-100 text-green-800",
    MENIPIS: "bg-amber-100 text-amber-800",
    HABIS: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────

function InventoryValuationContent() {
  const [data, setData] = useState<InventoryItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kategoriFilter, setKategoriFilter] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/purchasing/reports/inventory-valuation");
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json: ApiResponse = await res.json();
      if (!json.success) throw new Error("Gagal memuat data");
      setData(json.data);
      setSummary(json.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounce search 400ms
  const debouncedSetSearch = useMemo(
    () => debounce((val: string) => setDebouncedSearch(val), 400),
    []
  );
  useEffect(() => {
    debouncedSetSearch(search);
  }, [search, debouncedSetSearch]);

  // Unique categories from data
  const categories = useMemo(
    () => Array.from(new Set(data.map((d) => d.kategori))).sort(),
    [data]
  );

  // Filtered rows
  const filtered = useMemo(() => {
    return data.filter((item) => {
      const matchSearch =
        !debouncedSearch ||
        item.nama.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        item.kode.toLowerCase().includes(debouncedSearch.toLowerCase());
      const matchKategori =
        kategoriFilter === "all" || item.kategori === kategoriFilter;
      return matchSearch && matchKategori;
    });
  }, [data, debouncedSearch, kategoriFilter]);

  function handleExportCSV() {
    exportToCSV(
      filtered.map((item) => ({
        kode: item.kode,
        nama: item.nama,
        kategori: item.kategori,
        qty_onhand: item.qty_onhand,
        satuan: item.satuan_besar?.nama ?? "",
        avg_cost: item.avg_cost,
        nilai_total: item.qty_onhand * item.avg_cost,
        status_stok: item.status_stok,
      })),
      [
        { key: "kode", header: "Kode" },
        { key: "nama", header: "Nama Bahan" },
        { key: "kategori", header: "Kategori" },
        { key: "qty_onhand", header: "Stok" },
        { key: "satuan", header: "Satuan" },
        { key: "avg_cost", header: "Avg HPP" },
        { key: "nilai_total", header: "Nilai Total" },
        { key: "status_stok", header: "Status" },
      ],
      "inventory-valuation"
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat data valuasi stok...</p>
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
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Nilai Inventory
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">
              {summary ? formatRupiah(summary.total_value) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">
              Total Item
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">
              {summary ? summary.total_items.toLocaleString("id-ID") : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown */}
      {summary && summary.by_category.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Nilai per Kategori
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {summary.by_category.map((cat) => (
              <Card key={cat.kategori} size="sm">
                <CardHeader>
                  <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {cat.kategori}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-base font-bold text-gray-900">
                    {formatRupiah(cat.total_value)}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cat.item_count} item
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Cari nama / kode..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={kategoriFilter} onValueChange={setKategoriFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">Tidak ada data ditemukan</p>
              <p className="text-xs mt-1">
                Coba ubah kata kunci atau filter kategori
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama Bahan</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Avg HPP</TableHead>
                  <TableHead className="text-right">Nilai Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {item.kode}
                    </TableCell>
                    <TableCell className="font-medium">{item.nama}</TableCell>
                    <TableCell>{item.kategori}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.qty_onhand.toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell>{item.satuan_besar?.nama ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(item.avg_cost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatRupiah(item.qty_onhand * item.avg_cost)}
                    </TableCell>
                    <TableCell>
                      <StockStatusBadge status={item.status_stok} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        Menampilkan {filtered.length} dari {data.length} item
      </p>
    </div>
  );
}

export default function InventoryValuationPage() {
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
            { label: "Valuasi Stok" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Valuasi Stok</h1>
            <p className="text-sm text-gray-500">
              Nilai inventori berdasarkan HPP rata-rata
            </p>
          </div>
          <Link href="/dashboard/purchasing/reports">
            <Button variant="ghost">Kembali</Button>
          </Link>
        </div>

        <InventoryValuationContent />
      </div>
    </PurchasingGuard>
  );
}
