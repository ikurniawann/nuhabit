"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { MasterTableActions } from "@/features/master-data/components/master-table-actions";
import { useFiscalYearList } from "../queries";
import { useDeleteFiscalYear } from "../mutations";
import { FISCAL_YEAR_ROUTES } from "../routes";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";
import { toast } from "sonner";

export function FiscalYearsPage() {
  const router = useRouter();
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();
  const [activeFilter, setActiveFilter] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      is_active: activeFilter || undefined,
    }),
    [search, activeFilter]
  );

  const { data, isLoading } = useFiscalYearList(filters);
  const deleteMutation = useDeleteFiscalYear();
  const rows = useMemo(() => data ?? [], [data]);
  const isDeleting = deleteMutation.isPending;


  const activeOptions = useMemo(
    () => [
      { value: "true", label: "Aktif" },
      { value: "false", label: "Nonaktif" },
    ],
    []
  );

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Fiscal year berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <div className="space-y-6">

      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fiscal Years</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Konfigurasi tahun fiskal dan period — wajib sebelum input jurnal
          </p>
        </div>
        <Button
          type="button"
          onClick={() => router.push(FISCAL_YEAR_ROUTES.new)}
          className="h-10 gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <PlusIcon className="h-4 w-4" />
          Tambah Fiscal Year
        </Button>
      </div>

      <PurchasingListSection
        icon={CalendarDaysIcon}
        title="Daftar Fiscal Year"
        description="Kelola period OPEN/CLOSED per bulan."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari kode / nama..."
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
              options={activeOptions}
              value={activeFilter}
              onChange={setActiveFilter}
              placeholder="Semua status"
              searchPlaceholder="Cari..."
              allowClear
              className={`${filterComboboxClassName} h-10 w-[160px] shrink-0 bg-card`}
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">
              Memuat fiscal years...
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">Belum ada fiscal year</p>
          </div>
        ) : (
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Kode</th>
                  <th className="px-3 py-3">Nama</th>
                  <th className="px-3 py-3">Periode</th>
                  <th className="px-3 py-3">Open</th>
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
                      {row.code}
                    </td>
                    <td className="px-3 py-3 text-foreground">{row.name}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {row.start_date} → {row.end_date}
                    </td>
                    <td className="px-3 py-3">
                      {row.open_periods_count}/{row.periods.length}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant={row.is_active ? "default" : "secondary"}
                        className="font-normal"
                      >
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(
                              FISCAL_YEAR_ROUTES.beginningBalance(row.id)
                            )
                          }
                          className="h-8 rounded-lg border-primary/20 text-brand-text"
                        >
                          Saldo Awal
                        </Button>
                        <MasterTableActions
                          onEdit={() =>
                            router.push(FISCAL_YEAR_ROUTES.edit(row.id))
                          }
                          onDelete={() => setDeleteId(row.id)}
                        />
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
        open={Boolean(deleteId)}
        onClose={() => {
          if (!isDeleting) setDeleteId(null);
        }}
        title="Hapus Fiscal Year"
        description="Fiscal year dan periods-nya akan dihapus. Tidak bisa jika masih dipakai journal entry."
        onConfirm={handleDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
