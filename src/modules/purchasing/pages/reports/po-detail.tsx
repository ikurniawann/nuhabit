"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  AlertCircle,
  FileText,
  ShoppingCart,
  Loader2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { formatRupiah, debounce } from "@/modules/purchasing/utils";

// ── Types ──────────────────────────────────────────────────

interface PORow {
  po_number: string;
  vendor: string;
  status: string;
  tanggal_po: string;
  total_amount: number;
  total_amount_formatted: string;
  item_count: number;
  // API may return id separately; fall back to po_number as key
  id?: string;
}

interface POItem {
  id: string;
  nama_bahan: string;
  qty: number;
  satuan: string;
  harga_satuan: number;
  subtotal: number;
}

interface POSummaryApiResponse {
  success: boolean;
  data: {
    summary: PORow[];
    by_status: unknown[];
    grand_total: number;
  };
}

interface POItemsApiResponse {
  success: boolean;
  data: POItem[];
}

// ── PO Status config ────────────────────────────────────────

const PO_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  waiting_approval: {
    label: "Menunggu Approval",
    className: "bg-amber-100 text-amber-800",
  },
  approved: { label: "Disetujui", className: "bg-blue-100 text-blue-800" },
  sent: { label: "Terkirim", className: "bg-indigo-100 text-indigo-800" },
  received: { label: "Diterima", className: "bg-green-100 text-green-800" },
  cancelled: { label: "Dibatalkan", className: "bg-red-100 text-red-800" },
};

function POStatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.label}
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

// ── Expandable row for line items ───────────────────────────

function POItemsRow({
  poId,
  poNumber,
}: {
  poId: string;
  poNumber: string;
}) {
  const [items, setItems] = useState<POItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/purchasing/po/${poId}/items`);
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const json: POItemsApiResponse = await res.json();
        if (!json.success) throw new Error("Gagal memuat item");
        if (!cancelled) setItems(json.data ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Gagal memuat item");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [poId]);

  if (loading) {
    return (
      <TableRow className="bg-gray-50">
        <TableCell colSpan={6} className="py-4">
          <div className="flex items-center gap-2 pl-8 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Memuat item PO {poNumber}...
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (error) {
    return (
      <TableRow className="bg-red-50">
        <TableCell colSpan={6} className="py-3">
          <p className="pl-8 text-xs text-red-600">{error}</p>
        </TableCell>
      </TableRow>
    );
  }

  if (items.length === 0) {
    return (
      <TableRow className="bg-gray-50">
        <TableCell colSpan={6} className="py-3">
          <p className="pl-8 text-xs text-gray-400 italic">
            Tidak ada item dalam PO ini
          </p>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {/* Sub-header */}
      <TableRow className="bg-gray-50 hover:bg-gray-50">
        <TableCell colSpan={6} className="py-1.5 px-4">
          <div className="pl-6 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Nama Bahan</span>
            <span className="text-right">Qty</span>
            <span>Satuan</span>
            <span className="text-right">Harga Satuan</span>
            <span className="text-right">Subtotal</span>
          </div>
        </TableCell>
      </TableRow>
      {items.map((item) => (
        <TableRow
          key={item.id}
          className="bg-gray-50 hover:bg-gray-100 border-l-4 border-l-blue-200"
        >
          <TableCell colSpan={6} className="py-2 px-4">
            <div className="pl-6 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 text-sm">
              <span className="text-gray-800">{item.nama_bahan}</span>
              <span className="text-right tabular-nums text-gray-700">
                {item.qty.toLocaleString("id-ID")}
              </span>
              <span className="text-gray-600">{item.satuan}</span>
              <span className="text-right tabular-nums text-gray-700">
                {formatRupiah(item.harga_satuan)}
              </span>
              <span className="text-right tabular-nums font-medium text-gray-900">
                {formatRupiah(item.subtotal)}
              </span>
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ── Main content ────────────────────────────────────────────

function PODetailContent() {
  const [data, setData] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Track which PO rows are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (statusFilter !== "all") params.set("status", statusFilter);
    return params.toString();
  }, [dateFrom, dateTo, statusFilter]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpanded(new Set());
    try {
      const qs = buildQuery();
      const res = await fetch(
        `/api/purchasing/reports/po-summary${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const json: POSummaryApiResponse = await res.json();
      if (!json.success) throw new Error("Gagal memuat data");
      setData(json.data.summary ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounce search
  const debouncedSetSearch = useMemo(
    () => debounce((val: string) => setDebouncedSearch(val), 400),
    []
  );
  useEffect(() => {
    debouncedSetSearch(search);
  }, [search, debouncedSetSearch]);

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return data;
    const q = debouncedSearch.toLowerCase();
    return data.filter(
      (row) =>
        row.po_number.toLowerCase().includes(q) ||
        row.vendor.toLowerCase().includes(q)
    );
  }, [data, debouncedSearch]);

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw className="w-8 h-8 animate-spin" />
          <p className="text-sm">Memuat detail PO...</p>
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
              <label className="text-xs text-gray-500 font-medium">Status</label>
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
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <label className="text-xs text-gray-500 font-medium">
                Cari No PO / Supplier
              </label>
              <Input
                placeholder="Cari..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full"
              />
            </div>
            <Button onClick={fetchData} className="sm:self-end">
              <RefreshCw className="w-4 h-4 mr-2" />
              Terapkan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {filtered.length} PO ditemukan — klik baris untuk melihat item
        </p>
        {expanded.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(new Set())}
            className="text-xs text-gray-400"
          >
            Tutup semua
          </Button>
        )}
      </div>

      {/* Table with expandable rows */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <ShoppingCart className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">Tidak ada PO ditemukan</p>
              <p className="text-xs mt-1">
                Coba ubah filter tanggal, status, atau kata kunci
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>No PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Tanggal PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Item</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const rowKey = row.id ?? row.po_number;
                  const isOpen = expanded.has(rowKey);
                  return (
                    <>
                      <TableRow
                        key={rowKey}
                        className="cursor-pointer hover:bg-blue-50 transition-colors"
                        onClick={() => toggleExpand(rowKey)}
                      >
                        <TableCell className="pr-0 text-gray-400">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-gray-700">
                          {row.po_number}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.vendor}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {formatDate(row.tanggal_po)}
                        </TableCell>
                        <TableCell>
                          <POStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-gray-600">
                          {row.item_count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {row.total_amount_formatted ??
                            formatRupiah(row.total_amount)}
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <POItemsRow
                          key={`items-${rowKey}`}
                          poId={rowKey}
                          poNumber={row.po_number}
                        />
                      )}
                    </>
                  );
                })}
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

export default function PODetailPage() {
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
            { label: "Detail PO" },
          ]}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detail PO</h1>
            <p className="text-sm text-gray-500">
              Rincian item tiap Purchase Order — klik baris untuk memperluas
            </p>
          </div>
          <Link href="/dashboard/purchasing/reports">
            <Button variant="ghost">
              <FileText className="w-4 h-4 mr-2" />
              Kembali
            </Button>
          </Link>
        </div>

        <PODetailContent />
      </div>
    </PurchasingGuard>
  );
}
