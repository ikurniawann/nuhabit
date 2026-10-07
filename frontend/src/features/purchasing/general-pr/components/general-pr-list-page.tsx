"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { Plus, Search, Filter, FileText, Eye, Printer, Pencil, X } from "lucide-react";
import { getPRStatusLabel, getPriorityBadge } from "@/lib/purchasing/status-labels";
import { toast } from "sonner";
import { useGeneralPurchaseRequestList } from "../queries";
import type { GeneralPRStatusFilter } from "../types";
import { formatDate, formatRupiah } from "@/lib/format";

const PR_STATUS_LABEL_OVERRIDES: Record<string, string> = {
  rejected: "Ditolak",
  converted: "Purchase Order Dibuat",
};

const PRIORITY_LABEL_OVERRIDES: Record<string, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Mendesak",
};

export function GeneralPRListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GeneralPRStatusFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const handledCreatedToast = useRef<string | null>(null);
  const limit = 10;

  const listQuery = useGeneralPurchaseRequestList({
    page,
    limit,
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: search || undefined,
  });
  const prs = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (listQuery.isError) {
      toast.error("Gagal memuat permintaan barang");
    }
  }, [listQuery.isError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    const created = searchParams.get("created");
    if (!created) return;
    if (handledCreatedToast.current === created) return;
    handledCreatedToast.current = created;
    toast.success(created === "draft" ? "Draft permintaan barang disimpan" : "Permintaan barang diajukan");
    router.replace(GENERAL_ROUTES.purchasingPr);
  }, [router, searchParams]);

  const statusOptions = [
    { value: "all", label: "Semua Status" },
    { value: "draft", label: "Draft" },
    { value: "pending_head", label: "Menunggu Kepala Departemen" },
    { value: "pending_finance", label: "Menunggu Finance" },
    { value: "pending_direksi", label: "Menunggu Direksi" },
    { value: "approved", label: "Disetujui" },
    { value: "rejected", label: "Ditolak" },
    { value: "converted", label: "Purchase Order Dibuat" },
  ];
  const isFilterActive = statusFilter !== "all";

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Permintaan Barang"
        description={`Kelola permintaan barang operasional — ${total} total`}
        actions={
          <Link href={GENERAL_ROUTES.purchasingPrInsert}>
            <Button className="purchasing-main-button w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Buat Permintaan Barang
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={FileText}
        title="Daftar Permintaan Barang"
        description="Lacak permintaan barang operasional berdasarkan nomor dokumen, status, prioritas, dan nilai total."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor permintaan barang..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Bersihkan pencarian"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className="h-10 gap-2 rounded-lg"
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
            {(search || isFilterActive || page > 1) && (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setSearchQuery("");
                  setStatusFilter("all");
                  setPage(1);
                }}
                className="h-10 flex-shrink-0 rounded-lg"
              >
                Reset
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
              <Combobox
                options={statusOptions}
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value as GeneralPRStatusFilter);
                  setPage(1);
                }}
                placeholder="Filter status..."
                searchPlaceholder="Cari status..."
                emptyMessage="Status tidak ditemukan"
                className="!w-full h-9 text-sm md:max-w-xs"
              />
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
              <p className="mt-2 text-sm text-gray-500">Memuat permintaan barang...</p>
            </div>
          ) : prs.length === 0 ? (
            <div className="py-14 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Belum ada permintaan barang</p>
              <Link href={GENERAL_ROUTES.purchasingPrInsert}>
                <Button variant="outline" className="mt-4 purchasing-secondary-button">
                  Buat Permintaan Barang Pertama
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Nomor</th>
                      <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                      <th className="px-4 py-3 text-left font-semibold">Departemen</th>
                      <th className="px-4 py-3 text-left font-semibold">Pemohon</th>
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                      <th className="px-4 py-3 text-center font-semibold">Prioritas</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {prs.map((pr) => {
                      const statusBadge = getPRStatusLabel(pr.status);
                      const priorityBadge = getPriorityBadge(pr.priority);
                      const statusLabel = PR_STATUS_LABEL_OVERRIDES[pr.status] ?? statusBadge.label;
                      const priorityLabel = PRIORITY_LABEL_OVERRIDES[pr.priority] ?? priorityBadge.label;

                      return (
                        <tr
                          key={pr.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => router.push(GENERAL_ROUTES.purchasingPrDetail(pr.id))}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">{pr.pr_number}</td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(pr.created_at)}</td>
                          <td className="px-4 py-3 text-gray-600">{pr.department_name || "-"}</td>
                          <td className="px-4 py-3 text-gray-600">{pr.requester_name || "-"}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatRupiah(pr.total_amount)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={priorityBadge.color}>{priorityLabel}</Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={statusBadge.color}>{statusLabel}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <Link href={GENERAL_ROUTES.purchasingPrDetail(pr.id)}>
                                <Button variant="ghost" size="sm" title="Lihat detail" className="cursor-pointer">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {pr.status === "draft" && (
                                <Link href={GENERAL_ROUTES.purchasingPrEdit(pr.id)}>
                                  <Button variant="ghost" size="sm" title="Ubah" className="cursor-pointer">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                              <Link href={`/dashboard/purchasing/print/pr/${pr.id}`} target="_blank">
                                <Button variant="ghost" size="sm" title="Cetak" className="cursor-pointer">
                                  <Printer className="h-4 w-4" />
                                </Button>
                              </Link>
                            </div>
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
