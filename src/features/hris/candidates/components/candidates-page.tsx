"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { downloadCSV } from "@/lib/utils/csv-export";
import { candidatesCsv } from "@/lib/recruitment/candidate-csv";
import { useCandidateList, useCandidateBrands } from "../queries";
import { useDeleteCandidate } from "../mutations";
import { fetchAllCandidates } from "../api";
import type { CandidateRow } from "../types";
import { AddCandidateDialog } from "./add-candidate-dialog";
import { CandidateFilters, EMPTY_CANDIDATE_FILTER, type CandidateFilterValues } from "./candidate-filters";
import { CandidatesMobileHeader } from "./candidates-mobile-header";
import { CandidatesPagination, CandidatesTable } from "./candidates-table";

const PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 400;

export function CandidatesPage() {
  const [filter, setFilter] = useState<CandidateFilterValues>(EMPTY_CANDIDATE_FILTER);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CandidateRow | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const listQuery = useCandidateList({ ...filter, page, perPage: PER_PAGE });
  const brands = useCandidateBrands().data ?? [];
  const deleteMutation = useDeleteCandidate();

  const candidates = listQuery.data?.data ?? [];
  const totalCount = listQuery.data?.count ?? 0;

  const applyFilter = (patch: Partial<CandidateFilterValues>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => applyFilter({ search: value }), SEARCH_DEBOUNCE_MS);
  };

  const handleExportCSV = async () => {
    try {
      const data = await fetchAllCandidates(filter);
      if (data.length === 0) return;
      downloadCSV(candidatesCsv(data), `kandidat_${new Date().toISOString().split("T")[0]}.csv`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export CSV");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      // dialog tetap terbuka supaya bisa dicoba lagi
      toast.error(error instanceof Error ? error.message : "Gagal menghapus kandidat");
    }
  };

  return (
    <div className="space-y-6">
      <CandidatesMobileHeader
        totalCount={totalCount}
        onExport={handleExportCSV}
        onAdd={() => setShowAddDialog(true)}
      />

      <div className="hidden lg:flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kandidat</h1>
          <p className="text-gray-500 text-sm mt-1">{totalCount} kandidat ditemukan</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Export CSV</span>
            <span className="sm:hidden">CSV</span>
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Tambah Kandidat</span>
            <span className="sm:hidden">Tambah</span>
          </Button>
        </div>
      </div>

      <CandidateFilters
        filter={filter}
        searchInput={searchInput}
        brands={brands}
        onSearchInput={handleSearchInput}
        onChange={applyFilter}
      />

      <Card>
        <CardContent className="p-0">
          <CandidatesTable
            candidates={candidates}
            loading={listQuery.isLoading}
            offset={(page - 1) * PER_PAGE}
            onDelete={setDeleteTarget}
          />
          <CandidatesPagination page={page} perPage={PER_PAGE} totalCount={totalCount} onPageChange={setPage} />
        </CardContent>
      </Card>

      {showAddDialog && <AddCandidateDialog brands={brands} onClose={() => setShowAddDialog(false)} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Hapus Kandidat"
        description={
          <>
            Apakah kamu yakin ingin menghapus kandidat{" "}
            <span className="font-medium text-gray-900">{deleteTarget?.full_name}</span>? Tindakan ini tidak dapat
            dibatalkan.
          </>
        }
        confirmLabel="Hapus"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
