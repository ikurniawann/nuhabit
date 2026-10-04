"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQCList } from "../queries";
import {
  QC_HASIL_COLORS,
  QC_HASIL_LABELS,
  formatQcMaterialsSummary,
  getQcDisplayNumber,
  getQcGrnNumber,
  getQcTotals,
} from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import {
  BeakerIcon,
  MagnifyingGlassIcon,
  EyeIcon,
} from "@heroicons/react/24/outline";
import { X } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

export function QCListPage() {
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const limit = 15;

  const listQuery = useQCList({ page, limit, search: search || undefined });
  const records = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (!listQuery.isError) return;
    toast.error(
      listQuery.error instanceof Error
        ? listQuery.error.message
        : "Gagal memuat daftar QC"
    );
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  function handleResetFilters() {
    setSearch("");
    setSearchQuery("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quality Control</h1>
          <p className="text-sm text-gray-500">Inspeksi &amp; kualitas bahan baku dari GRN</p>
        </div>
      </div>

      <PurchasingListSection
        icon={BeakerIcon}
        title="Daftar QC"
        description="Pantau inspeksi QC, hasil penerimaan, dan dokumen GRN terkait."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor GRN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            {(search || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-9 flex-shrink-0">
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {loading ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">Memuat data...</p>
            </div>
          ) : records.length === 0 ? (
            <div className="py-14 text-center">
              <BeakerIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Belum ada data QC</p>
              <p className="mt-1 text-xs text-gray-400">
                QC dibuat setelah inspeksi barang pada dokumen GRN.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto px-4">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-200/70 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      {[
                        "No. QC",
                        "GRN",
                        "Bahan Baku",
                        "Diperiksa",
                        "Diterima",
                        "Ditolak",
                        "Hasil",
                        "Tanggal",
                        "Aksi",
                      ].map((h) => (
                        <th
                          key={h}
                          className={`px-4 py-3 font-semibold ${h === "Aksi" ? "text-right" : "text-left"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/70">
                    {records.map((q) => {
                      const totals = getQcTotals(q);
                      const hasilKey = String(q.hasil || q.status || "partial").toLowerCase();

                      return (
                        <tr key={q.id} className="transition-colors hover:bg-gray-50/80">
                          <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">
                            {getQcDisplayNumber(q)}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {getQcGrnNumber(q)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {formatQcMaterialsSummary(q.items)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm">{totals.inspected}</td>
                          <td className="px-4 py-3 text-center text-sm font-medium text-green-700">
                            {totals.accepted}
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-medium text-red-600">
                            {totals.rejected}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={QC_HASIL_COLORS[hasilKey] || "bg-gray-100 text-gray-800"}>
                              {QC_HASIL_LABELS[hasilKey] || hasilKey}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {formatDate(q.tanggal_inspeksi || q.created_at, "—")}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link href={`/dashboard/purchasing/qc/${q.id}`}>
                              <Button size="sm" variant="ghost" aria-label="Lihat detail QC">
                                <EyeIcon className="h-4 w-4" />
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <PurchasingTablePagination
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={limit}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}
