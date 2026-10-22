"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Plus, Search, RefreshCw, AlertCircle, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { BreadcrumbNav } from "@/modules/purchasing/components/breadcrumb/BreadcrumbNav";
import PurchasingGuard from "@/modules/purchasing/components/auth/PurchasingGuard";
import { KATEGORI_OPTIONS, COA_OPTIONS } from "@/types/raw-material";

// ── Label maps ────────────────────────────────────────────────────────────────

const KATEGORI_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Bahan Pangan",
  BAHAN_NON_PANGAN: "Bahan Non-Pangan",
  KEMASAN: "Kemasan",
  BAHAN_BAKAR: "Bahan Bakar",
  LAINNYA: "Lainnya",
};

// COA_OPTIONS from @/types/raw-material: [{ value, label }]
// COA display labels: PRODUCTION=Produksi, RND=R&D, ASSET=Asset
const COA_LABEL_MAP: Record<string, string> = {
  PRODUCTION: "Produksi",
  RND: "R&D",
  ASSET: "Asset",
};

// ── Badge helpers ─────────────────────────────────────────────────────────────

function StokBadge({ status }: { status: string }) {
  const cls =
    status === "AMAN"
      ? "bg-green-100 text-green-800 hover:bg-green-100 border-0"
      : status === "MENIPIS"
      ? "bg-orange-100 text-orange-800 hover:bg-orange-100 border-0"
      : status === "HABIS"
      ? "bg-red-100 text-red-800 hover:bg-red-100 border-0"
      : "bg-gray-100 text-gray-700 hover:bg-gray-100 border-0";
  return <Badge className={cls}>{status}</Badge>;
}

function CoaBadge({ coa }: { coa: string | null }) {
  if (!coa) return <span className="text-gray-400 text-xs">—</span>;
  const cls =
    coa === "PRODUCTION"
      ? "bg-blue-100 text-blue-800 hover:bg-blue-100 border-0"
      : coa === "RND"
      ? "bg-purple-100 text-purple-800 hover:bg-purple-100 border-0"
      : coa === "ASSET"
      ? "bg-amber-100 text-amber-800 hover:bg-amber-100 border-0"
      : "bg-gray-100 text-gray-700 hover:bg-gray-100 border-0";
  return <Badge className={cls}>{COA_LABEL_MAP[coa] ?? coa}</Badge>;
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRows({ cols = 8, rows = 3 }: { cols?: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={`sk-${i}`}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[100px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawMaterialItem {
  id: string;
  kode: string;
  nama: string;
  kategori: string | null;
  coa: string | null;
  qty_onhand: number;
  status_stok: string;
  satuan_besar: { nama: string } | null;
  satuan_kecil: { nama: string } | null;
  is_active: boolean;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RawMaterialsListPage() {
  const [items, setItems] = useState<RawMaterialItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 20;

  // Filter state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kategori, setKategori] = useState("all");
  const [coa, setCoa] = useState("all");

  // Debounce search 400 ms
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 400);
  };

  const handleKategoriChange = (val: string) => {
    setKategori(val);
    setPage(1);
  };

  const handleCoaChange = (val: string) => {
    setCoa(val);
    setPage(1);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(perPage),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (kategori !== "all") params.set("kategori", kategori);
      if (coa !== "all") params.set("coa", coa);

      const res = await fetch(`/api/purchasing/raw-materials?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Gagal memuat data");
      setItems(json.data || []);
      setTotal(json.pagination?.total ?? 0);
      setTotalPages(json.pagination?.total_pages ?? 0);
    } catch (e: any) {
      setError(e.message ?? "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, kategori, coa]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build page numbers with ellipsis
  const visiblePages = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "ellipsis")[] = [1];
    if (page > 3) pages.push("ellipsis");
    for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) {
      pages.push(p);
    }
    if (page < totalPages - 2) pages.push("ellipsis");
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  }, [page, totalPages]);

  const rangeStart = (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, total);

  return (
    <PurchasingGuard
      allowedRoles={[
        "purchasing_staff",
        "purchasing_manager",
        "purchasing_admin",
        "super_admin",
      ]}
    >
      <div className="space-y-6">
        <BreadcrumbNav
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Purchasing", href: "/dashboard/purchasing" },
            { label: "Bahan Baku" },
          ]}
        />

        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bahan Baku</h1>
            <p className="text-sm text-gray-500">Master data bahan baku</p>
          </div>
          <Link href="/dashboard/items/raw-materials/insert">
            <Button>
              <Plus className="w-4 h-4 mr-1.5" />
              Tambah Bahan
            </Button>
          </Link>
        </div>

        {/* Summary stat */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Package className="w-4 h-4 text-gray-400 shrink-0" />
          Total:{" "}
          <span className="font-semibold text-gray-900">{total}</span> item
        </div>

        {/* Filter bar */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Cari kode atau nama bahan..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>

              <Select value={kategori} onValueChange={handleKategoriChange}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {KATEGORI_OPTIONS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KATEGORI_LABELS[k] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={coa} onValueChange={handleCoaChange}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="COA" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua COA</SelectItem>
                  {COA_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="icon" onClick={fetchData} title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {error ? (
              <div className="flex flex-col items-center gap-3 py-16 text-gray-500">
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-600">{error}</p>
                <Button variant="outline" onClick={fetchData}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Coba Lagi
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>COA</TableHead>
                    <TableHead>Satuan</TableHead>
                    <TableHead className="text-right">Stok</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right w-[130px]">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonRows cols={8} rows={3} />
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-16 text-gray-400">
                        <Package className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">Tidak ada data bahan baku</p>
                        {(debouncedSearch || kategori !== "all" || coa !== "all") && (
                          <p className="text-xs mt-1 text-gray-400">
                            Coba ubah filter atau kata kunci
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs text-gray-600">
                          {item.kode}
                        </TableCell>
                        <TableCell className="font-medium max-w-[200px]">
                          <span className="truncate block">{item.nama}</span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.kategori
                            ? (KATEGORI_LABELS[item.kategori] ?? item.kategori)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <CoaBadge coa={item.coa} />
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {item.satuan_besar?.nama ?? "—"}
                          {item.satuan_kecil && (
                            <span className="text-gray-400">
                              {" / "}
                              {item.satuan_kecil.nama}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {item.qty_onhand?.toLocaleString("id-ID", {
                            maximumFractionDigits: 3,
                          }) ?? "0"}
                        </TableCell>
                        <TableCell>
                          <StokBadge status={item.status_stok} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Link
                              href={`/dashboard/items/raw-materials/${item.id}`}
                            >
                              <Button variant="ghost" size="sm">
                                Detail
                              </Button>
                            </Link>
                            <Link
                              href={`/dashboard/items/raw-materials/edit/${item.id}`}
                            >
                              <Button variant="outline" size="sm">
                                Edit
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-600">
            <span>
              Menampilkan {rangeStart}–{rangeEnd} dari {total} item
            </span>
            <Pagination className="w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={
                      page <= 1
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  />
                </PaginationItem>

                {visiblePages.map((p, i) =>
                  p === "ellipsis" ? (
                    <PaginationItem key={`ell-${i}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === page}
                        onClick={() => setPage(p as number)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}

                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={
                      page >= totalPages
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </PurchasingGuard>
  );
}
