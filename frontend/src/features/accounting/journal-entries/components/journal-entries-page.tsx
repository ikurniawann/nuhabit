"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { JOURNAL_ENTRY_STATUSES } from "@/lib/accounting/fiscal-types";
import { useJournalEntryList } from "../queries";
import { useDeleteJournalEntry, usePostJournalEntry } from "../mutations";
import { JOURNAL_ENTRY_ROUTES } from "../routes";
import { formatLedgerAmount } from "@/lib/accounting/format";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";
import { toast } from "sonner";

export function JournalEntriesPage() {
  const router = useRouter();
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    search,
  } = useDebouncedSearch();
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      status: statusFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [search, statusFilter, dateFrom, dateTo],
  );

  const { data, isLoading } = useJournalEntryList(filters);
  const deleteMutation = useDeleteJournalEntry();
  const postMutation = usePostJournalEntry();
  const rows = useMemo(() => data ?? [], [data]);
  const isDeleting = deleteMutation.isPending;

  const statusOptions = useMemo(
    () => JOURNAL_ENTRY_STATUSES.map((s) => ({ value: s, label: s })),
    [],
  );

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Journal entry berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  async function handlePost(id: string) {
    if (postMutation.isPending) return;
    setPostingId(id);
    try {
      const res = await postMutation.mutateAsync(id);
      toast.success(res.message || "Journal entry berhasil diposting");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal posting");
    } finally {
      setPostingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Journal Entries
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jurnal manual (Draft / Posted) — {rows.length} entri
          </p>
        </div>
        <Button
          type="button"
          onClick={() => router.push(JOURNAL_ENTRY_ROUTES.new)}
          className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Jurnal
        </Button>
      </div>

      <PurchasingListSection
        icon={DocumentTextIcon}
        title="Daftar Journal Entry"
        description="Edit/hapus hanya untuk Draft tanpa flag recon."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari no / deskripsi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-card pl-9 pr-9 text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <Combobox
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Semua status"
              searchPlaceholder="Cari status..."
              allowClear
              className={`${filterComboboxClassName} h-10 w-[140px] shrink-0 bg-card`}
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-10 w-[150px] bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Dari tanggal"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-10 w-[150px] bg-card text-sm focus:border-primary/40 focus:ring-1 focus:ring-primary/30"
              aria-label="Sampai tanggal"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">
              Memuat journal entries...
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">Belum ada journal entry</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">No</th>
                  <th className="px-3 py-3">Tanggal</th>
                  <th className="px-3 py-3">Deskripsi</th>
                  <th className="px-3 py-3">Period</th>
                  <th className="px-3 py-3 text-right">Debit</th>
                  <th className="px-3 py-3 text-right">Credit</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-200/70 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-3 font-medium text-foreground">
                      {row.entry_no}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.entry_date}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3 text-foreground">
                      {row.description || "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.fiscal_period_name || "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatLedgerAmount(row.total_debit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatLedgerAmount(row.total_credit)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.entry_type === "OPENING" ? (
                          <Badge variant="outline" className="font-normal">
                            OPENING
                          </Badge>
                        ) : null}
                        <Badge
                          variant={
                            row.status === "POSTED" ? "default" : "secondary"
                          }
                          className="font-normal"
                        >
                          {row.status}
                        </Badge>
                        {row.is_recon ? (
                          <Badge variant="outline" className="font-normal">
                            Recon
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {row.status === "DRAFT" &&
                        row.entry_type === "MANUAL" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={postingId === row.id}
                            onClick={() => handlePost(row.id)}
                            className="h-8 rounded-lg border-primary/20 text-brand-text"
                          >
                            {postingId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Post"
                            )}
                          </Button>
                        ) : null}
                        {row.can_edit ? (
                          <MasterTableActions
                            onEdit={() =>
                              router.push(JOURNAL_ENTRY_ROUTES.edit(row.id))
                            }
                            onDelete={() => setDeleteId(row.id)}
                          />
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              router.push(JOURNAL_ENTRY_ROUTES.edit(row.id))
                            }
                            className="h-8 text-muted-foreground"
                          >
                            Lihat
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <MasterDeleteDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title="Hapus journal entry?"
        description="Draft akan di-soft-delete. Posted / recon tidak bisa dihapus."
      />
    </div>
  );
}
