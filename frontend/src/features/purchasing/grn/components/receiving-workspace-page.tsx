"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardDocumentCheckIcon, TruckIcon } from "@heroicons/react/24/outline";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { PurchasingTablePagination } from "@/features/purchasing/components/shared/purchasing-table-pagination";
import {
  RECEIVING_STATUS_LABELS,
  buildReceivingRows,
  countReceivingRows,
  filterReceivingRows,
  type ReceivingStatus,
} from "@/lib/purchasing/receiving-ui-workspace";
import type { PurchasingModuleType } from "../api";
import { useReceivingWorkspace } from "../queries";
import { ReceivingWorkspaceTable } from "./receiving-workspace-table";

const PAGE_SIZE = 10;
const STAT_STATUSES: ReceivingStatus[] = ["in_delivery", "partially_received", "received", "rejected"];
const FILTER_STATUSES: ReceivingStatus[] = ["in_delivery", "partially_received", "received", "rejected", "cancelled"];
const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  ...FILTER_STATUSES.map((status) => ({ value: status, label: RECEIVING_STATUS_LABELS[status] })),
];

export function ReceivingWorkspacePage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const isProduct = moduleType === "product";
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReceivingStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);

  const workspaceQuery = useReceivingWorkspace(moduleType);
  const rows = useMemo(
    () => (workspaceQuery.data ? buildReceivingRows(workspaceQuery.data) : []),
    [workspaceQuery.data]
  );
  const filteredRows = filterReceivingRows(rows, statusFilter, search);
  const counts = countReceivingRows(rows);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const isFilterActive = statusFilter !== "all";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  function resetFilters() {
    setSearch("");
    setSearchQuery("");
    setStatusFilter("all");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Penerimaan (GRN)</h1>
        <p className="text-sm text-gray-500">
          Pantau pengiriman, penerimaan, qty diterima/ditolak, dan sisa kiriman — {filteredRows.length} total
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {STAT_STATUSES.map((status) => (
          <Card key={status} className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-gray-500">{RECEIVING_STATUS_LABELS[status]}</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{counts[status] ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <PurchasingListSection
        icon={ClipboardDocumentCheckIcon}
        title="Daftar Penerimaan (GRN)"
        description="Setiap baris adalah purchase order yang sudah punya pengiriman. Buat GRN (terima + QC), lanjutkan penerimaan sebagian, atau tinjau yang sudah selesai. GRN lama yang menunggu QC masih menampilkan aksi QC."
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={`Cari PO, ${isProduct ? "vendor" : "supplier"}, surat jalan, no. resi, atau GRN...`}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
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
            {(search || isFilterActive) && (
              <Button variant="outline" onClick={resetFilters} className="h-10 flex-shrink-0 rounded-lg">
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
                      setStatusFilter(value as ReceivingStatus | "all");
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

          {workspaceQuery.isLoading ? (
            <div className="py-12 text-center">
              <p className="text-sm text-gray-500">Memuat data penerimaan...</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-14 text-center">
              <TruckIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p className="text-gray-500">Tidak ada data yang cocok dengan filter saat ini</p>
            </div>
          ) : (
            <>
              <ReceivingWorkspaceTable rows={pageRows} isProduct={isProduct} />
              <PurchasingTablePagination
                page={page}
                totalPages={totalPages}
                totalItems={filteredRows.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </PurchasingListSection>
    </div>
  );
}
