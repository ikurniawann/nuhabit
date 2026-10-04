"use client";

import { useState, useEffect } from "react";
import { useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import {
  Plus,
  Search,
  Filter,
  FileText,
  Eye,
  Printer,
  Pencil,
  X,
} from "lucide-react";
import { getPRStatusLabel, getPriorityBadge } from "@/lib/purchasing/status-labels";
import { toast } from "sonner";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { useAuth } from "@/hooks/use-auth";
import { usePurchaseRequestList } from "../queries";
import type { PRStatusFilter as PRStatus } from "../types";
import { formatDate } from "@/lib/format";

function canCreatePurchaseOrder(
  pr: { status: string; converted_po_id?: string | null },
  role?: string
) {
  return (
    pr.status === "approved" &&
    !pr.converted_po_id &&
    ["purchasing_manager", "purchasing_staff", "purchasing_admin", "admin", "super_admin"].includes(
      role ?? ""
    )
  );
}

export function PRListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PRStatus>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const handledCreatedToast = useRef<string | null>(null);
  const limit = 10;

  const listQuery = usePurchaseRequestList({
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
      console.error("Error fetching purchase requests:", listQuery.error);
      toast.error("Gagal memuat purchase request");
    }
  }, [listQuery.isError, listQuery.error]);

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

    toast.success(
      created === "draft"
        ? "Draf purchase request berhasil disimpan"
        : "Purchase request berhasil diajukan"
    );
    router.replace("/dashboard/purchasing/pr");
  }, [router, searchParams]);

  function handleResetFilters() {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  const statusOptions = [
    { value: "all", label: "Semua Status" },
    { value: "draft", label: "Draf" },
    { value: "pending_head", label: "Menunggu Persetujuan Head Departemen" },
    { value: "pending_finance", label: "Menunggu Persetujuan Finance" },
    { value: "pending_direksi", label: "Menunggu Persetujuan Direktur" },
    { value: "approved", label: "Disetujui" },
    { value: "rejected", label: "Ditolak" },
    { value: "converted", label: "Purchase Order Dibuat" },
  ];
  const isFilterActive = statusFilter !== "all";

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Purchase Request"
        description={`Kelola purchase request — total ${total}`}
        actions={
          <Link href="/dashboard/purchasing/pr/insert">
            <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Tambah Purchase Request
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={FileText}
        title="Daftar Purchase Request"
        description="Pantau purchase request berdasarkan nomor dokumen, status, dan prioritas."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor purchase request..."
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

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className={isFilterActive ? "h-4 w-4 text-white" : "h-4 w-4"} />
              Filter
              {isFilterActive && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  1
                </span>
              )}
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button variant="outline" onClick={handleResetFilters} className="h-10 flex-shrink-0 rounded-lg">
                Atur Ulang
              </Button>
            )}
          </div>
        }
      >
        <div>
          {filterOpen && (
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Status
                  </div>
                  <Combobox
                    options={statusOptions}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as PRStatus);
                      setPage(1);
                    }}
                    placeholder="Filter status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
              <p className="mt-2 text-sm text-gray-500">Memuat purchase request...</p>
            </div>
          ) : prs.length === 0 ? (
            <div className="py-14 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Purchase request tidak ditemukan</p>
              <Link href="/dashboard/purchasing/pr/insert">
                <Button
                  variant="outline"
                  className="mt-4 h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
                >
                  Tambah Purchase Request Pertama
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
                      <th className="px-4 py-3 text-left font-semibold">Diminta Oleh</th>
                      <th className="px-4 py-3 text-center font-semibold">Prioritas</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {prs.map((pr) => {
                      const statusBadge = getPRStatusLabel(pr.status);
                      const priorityBadge = getPriorityBadge(pr.priority);
                      const statusLabel = statusBadge.label;
                      const priorityLabel = priorityBadge.label;

                      return (
                        <tr
                          key={pr.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => router.push(`/dashboard/purchasing/pr/${pr.id}`)}
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900">{pr.pr_number}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(pr.created_at)}</td>
                          <td className="px-4 py-3 text-gray-600">{pr.department_name || "-"}</td>
                          <td className="px-4 py-3 text-gray-600">{pr.requester_name || "-"}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={priorityBadge.color}>{priorityLabel}</Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={statusBadge.color}>{statusLabel}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <Link href={`/dashboard/purchasing/pr/${pr.id}`}>
                                <Button variant="ghost" size="sm" title="Detail" className="cursor-pointer">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {pr.status === "draft" && (
                                <Link href={`/dashboard/purchasing/pr/edit/${pr.id}`}>
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
                              {canCreatePurchaseOrder(pr, user?.role) && (
                                <Link href={`${RM_ROUTES.purchasingPoInsert}?pr_id=${pr.id}`}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Buat Purchase Order"
                                    className="cursor-pointer"
                                  >
                                    <FileText className="h-4 w-4 text-pink-600" />
                                  </Button>
                                </Link>
                              )}
                              {(pr.status === "converted" || pr.converted_po_id) && pr.converted_po_id && (
                                <Link href={RM_ROUTES.purchasingPoDetail(pr.converted_po_id)}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Lihat Purchase Order"
                                    className="cursor-pointer"
                                  >
                                    <FileText className="h-4 w-4 text-blue-600" />
                                  </Button>
                                </Link>
                              )}
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
