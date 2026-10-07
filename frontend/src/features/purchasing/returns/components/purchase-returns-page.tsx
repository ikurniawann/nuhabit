"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReturnList } from "../queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { PurchasingPageHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import { getReturnsModuleConfig } from "../returns-module";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  RETURN_STATUS_COLORS,
  RETURN_STATUS_LABELS,
  RETURN_REASON_LABELS,
  ReturnStatus,
  ReturnReasonType,
} from "@/types/purchasing";
import { Plus, Search, Filter, RotateCcw, Eye, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatNumber } from "@/lib/format";

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "draft", label: "Draf" },
  { value: "pending_approval", label: "Menunggu Persetujuan" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

const REASON_OPTIONS = [
  { value: "all", label: "Semua Alasan" },
  { value: "damaged", label: "Barang Rusak" },
  { value: "wrong_item", label: "Barang Salah" },
  { value: "expired", label: "Kedaluwarsa" },
  { value: "overstock", label: "Kelebihan Stok" },
  { value: "specification_mismatch", label: "Tidak Sesuai Spesifikasi" },
  { value: "other", label: "Lainnya" },
];

function getGrnNumber(ret: {
  grn_number?: string | null;
  grn_id?: string | null;
  grn?: { grn_number?: string | null; nomor_grn?: string | null } | null;
}) {
  return ret.grn_number || ret.grn?.grn_number || ret.grn?.nomor_grn || "-";
}

function getGrnId(ret: {
  grn_id?: string | null;
  grn?: { id?: string | null } | null;
}) {
  return ret.grn?.id || ret.grn_id || null;
}

export function PurchaseReturnsPage({
  moduleType = "raw_material",
}: {
  moduleType?: PurchasingModuleType;
}) {
  const config = getReturnsModuleConfig(moduleType);
  const router = useRouter();
  const [page, setPage] = useState(1);
  const limit = 10;
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | "all">("all");
  const [reasonFilter, setReasonFilter] = useState<ReturnReasonType | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const listQuery = useReturnList(
    {
      page,
      limit,
      status: statusFilter === "all" ? undefined : statusFilter,
      reason_type: reasonFilter === "all" ? undefined : reasonFilter,
      search: search || undefined,
    },
    moduleType
  );
  const returns = listQuery.data?.data ?? [];
  const loading = listQuery.isLoading;
  const total = listQuery.data?.pagination.total ?? 0;
  const totalPages = listQuery.data?.pagination.total_pages ?? 1;

  useEffect(() => {
    if (listQuery.isError) {
      console.error("Error loading returns:", listQuery.error);
      toast.error("Gagal memuat retur pembelian");
    }
  }, [listQuery.isError, listQuery.error]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const handleResetFilters = () => {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setReasonFilter("all");
    setPage(1);
  };

  const isFilterActive = statusFilter !== "all" || reasonFilter !== "all";
  const activeFilterCount = Number(statusFilter !== "all") + Number(reasonFilter !== "all");

  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Retur Pembelian"
        description={
          <>
            Kelola retur ke {config.partyLabel.toLowerCase()} untuk penerimaan barang yang sudah selesai QC — total {total}
          </>
        }
        actions={
          <Link href={config.insertRoute}>
            <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Tambah Retur
            </Button>
          </Link>
        }
      />

      <PurchasingListSection
        icon={RotateCcw}
        title="Daftar Retur Pembelian"
        description="Hanya penerimaan barang yang sudah menyelesaikan quality control yang dapat diretur."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Cari nomor retur, nomor GRN, atau catatan..."
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
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {(search || isFilterActive || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 flex-shrink-0 rounded-lg"
              >
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
                    options={STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value as ReturnStatus | "all");
                      setPage(1);
                    }}
                    placeholder="Filter status..."
                    searchPlaceholder="Cari status..."
                    emptyMessage="Status tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <Filter className="h-3.5 w-3.5 text-pink-500" />
                    Alasan
                  </div>
                  <Combobox
                    options={REASON_OPTIONS}
                    value={reasonFilter}
                    onChange={(value) => {
                      setReasonFilter(value as ReturnReasonType | "all");
                      setPage(1);
                    }}
                    placeholder="Filter alasan..."
                    searchPlaceholder="Cari alasan..."
                    emptyMessage="Alasan tidak ditemukan"
                    className="!w-full h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
              <p className="mt-2 text-sm text-gray-500">Memuat retur pembelian...</p>
            </div>
          ) : returns.length === 0 ? (
            <div className="py-14 text-center">
              <RotateCcw className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Retur pembelian tidak ditemukan</p>
              <p className="mt-1 text-sm text-gray-400">
                Retur hanya tersedia setelah quality control penerimaan barang selesai.
              </p>
              <Link href={config.insertRoute}>
                <Button
                  variant="outline"
                  className="mt-4 h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
                >
                  Tambah Retur
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">No. Retur</th>
                      <th className="px-4 py-3 text-left font-semibold">Tanggal</th>
                      <th className="px-4 py-3 text-left font-semibold">{config.partyLabel}</th>
                      <th className="px-4 py-3 text-left font-semibold">Alasan</th>
                      <th className="px-4 py-3 text-left font-semibold">Nomor GRN</th>
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {returns.map((ret) => {
                      const statusLabel =
                        RETURN_STATUS_LABELS[ret.status as ReturnStatus] || ret.status;
                      const reasonLabel =
                        RETURN_REASON_LABELS[ret.reason_type as ReturnReasonType] ||
                        ret.reason_type;
                      const grnNumber = getGrnNumber(ret);
                      const grnId = getGrnId(ret);

                      return (
                        <tr
                          key={ret.id}
                          className="cursor-pointer hover:bg-gray-50"
                          onClick={() => router.push(config.detailRoute(ret.id))}
                        >
                          <td
                            className="px-4 py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link
                              href={config.detailRoute(ret.id)}
                              className="font-medium text-pink-700 hover:underline"
                            >
                              {ret.return_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(ret.return_date)}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {config.partyNameFromReturn(ret)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="border-gray-200/80 font-normal">
                              {reasonLabel}
                            </Badge>
                          </td>
                          <td
                            className="px-4 py-3 text-gray-700"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {grnId && grnNumber !== "-" ? (
                              <Link
                                href={config.receiveDetailRoute(grnId)}
                                className="font-medium text-pink-700 hover:underline"
                              >
                                {grnNumber}
                              </Link>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatNumber(ret.total_amount)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge className={RETURN_STATUS_COLORS[ret.status as ReturnStatus]}>
                              {statusLabel}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {(ret.status === "draft" || ret.status === "pending_approval") && (
                                <Link href={config.editRoute(ret.id)}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Ubah retur"
                                    className="cursor-pointer"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Link>
                              )}
                              <Link href={config.detailRoute(ret.id)}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Lihat detail"
                                  className="cursor-pointer"
                                >
                                  <Eye className="h-4 w-4" />
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
                totalPages={Math.max(1, totalPages)}
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
