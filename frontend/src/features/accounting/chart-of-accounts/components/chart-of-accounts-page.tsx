"use client";

import { useMemo, useState } from "react";
import { PlusIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { MasterDeleteDialog } from "@/features/master-data/components/master-delete-dialog";
import { useAccountTypeList } from "@/features/accounting/account-types/queries";
import { useDebouncedSearch } from "@/features/accounting/shared/use-debounced-search";
import { buildCoaTree, collectExpandableCoaIds, flattenCoaTree } from "@/lib/accounting/coa-tree";
import { useCoaList } from "../queries";
import { useDeleteCoaAccount } from "../mutations";
import { formForNewChild, formFromAccount } from "../coa-form";
import type { CoaAccountItem } from "../types";
import { CoaAccountDialog, type CoaDialogState } from "./coa-account-dialog";
import { CoaImportDialog } from "./coa-import-dialog";
import { CoaTreeTable } from "./coa-tree-table";

const POSTABLE_FILTER_OPTIONS = [
  { value: "true", label: "Postable" },
  { value: "false", label: "Header" },
];

export function ChartOfAccountsPage() {
  const { query: searchQuery, setQuery: setSearchQuery, search } = useDebouncedSearch();
  const [typeFilter, setTypeFilter] = useState("");
  const [postableFilter, setPostableFilter] = useState("");
  const [dialogState, setDialogState] = useState<CoaDialogState>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      account_type_id: typeFilter || undefined,
      is_postable: postableFilter || undefined,
    }),
    [search, typeFilter, postableFilter]
  );
  const filtersKey = JSON.stringify(filters);

  // Default semua node terbuka; pilihan expand/collapse user berlaku untuk filter saat itu.
  const [expandOverride, setExpandOverride] = useState<{ key: string; ids: Set<string> } | null>(null);

  const { data, isLoading } = useCoaList(filters);
  const { data: allCoaData } = useCoaList();
  const { data: accountTypes } = useAccountTypeList();
  const deleteMutation = useDeleteCoaAccount();

  const rows = useMemo(() => data ?? [], [data]);
  const allRows = useMemo(() => allCoaData ?? [], [allCoaData]);
  const typeList = useMemo(() => accountTypes ?? [], [accountTypes]);
  const isDeleting = deleteMutation.isPending;

  const tree = useMemo(() => buildCoaTree(rows), [rows]);
  const expandableIds = useMemo(() => collectExpandableCoaIds(tree), [tree]);
  const expandedIds = useMemo(
    () => (expandOverride?.key === filtersKey ? expandOverride.ids : new Set(expandableIds)),
    [expandOverride, filtersKey, expandableIds]
  );
  const flatRows = useMemo(() => flattenCoaTree(tree, expandedIds), [tree, expandedIds]);

  function setExpanded(ids: Set<string>) {
    setExpandOverride({ key: filtersKey, ids });
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  function openAdd(parent: CoaAccountItem | null) {
    setDialogState({ editing: null, initial: formForNewChild(parent, typeList[0]?.id ?? "") });
  }

  function openEdit(item: CoaAccountItem) {
    setDialogState({ editing: item, initial: formFromAccount(item) });
  }

  async function handleDelete() {
    if (!deleteId || isDeleting) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Akun berhasil dihapus");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  const accountTypeFilterOptions = useMemo(
    () => typeList.map((t) => ({ value: t.id, label: t.code, description: t.name })),
    [typeList]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chart of Accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Master akun hierarkis — {rows.length} akun</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="h-10 gap-2 rounded-lg border-gray-200/80"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
            Import Excel
          </Button>
          <Button
            type="button"
            onClick={() => openAdd(null)}
            className="h-10 gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <PlusIcon className="h-4 w-4" />
            Tambah Akun
          </Button>
        </div>
      </div>

      <PurchasingListSection
        icon={PlusIcon}
        title="Daftar Akun"
        description="Tree Chart of Accounts. Hanya akun leaf yang postable."
        toolbar={
          <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
              options={accountTypeFilterOptions}
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="Semua type"
              searchPlaceholder="Cari type..."
              emptyMessage="Type tidak ditemukan"
              allowClear
              className={`${filterComboboxClassName} h-10 w-[180px] shrink-0 bg-card`}
            />
            <Combobox
              options={POSTABLE_FILTER_OPTIONS}
              value={postableFilter}
              onChange={setPostableFilter}
              placeholder="Semua"
              searchPlaceholder="Cari..."
              emptyMessage="Tidak ditemukan"
              allowClear
              className={`${filterComboboxClassName} h-10 w-[150px] shrink-0 bg-card`}
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-gray-200/80"
              onClick={() => setExpanded(new Set(expandableIds))}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-lg border-gray-200/80"
              onClick={() => setExpanded(new Set())}
            >
              Collapse
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <div className="py-14 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-text" />
            <p className="mt-2 text-sm text-muted-foreground">Memuat COA...</p>
          </div>
        ) : flatRows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-muted-foreground">Belum ada akun</p>
            <Button
              type="button"
              className="mt-4 h-10 rounded-lg bg-primary text-primary-foreground"
              onClick={() => openAdd(null)}
            >
              Tambah akun pertama
            </Button>
          </div>
        ) : (
          <CoaTreeTable
            flatRows={flatRows}
            expandedIds={expandedIds}
            toggleExpand={toggleExpand}
            openAdd={openAdd}
            openEdit={openEdit}
            onDelete={setDeleteId}
          />
        )}
      </PurchasingListSection>

      <CoaAccountDialog
        state={dialogState}
        onClose={() => setDialogState(null)}
        accountTypes={typeList}
        allRows={allRows}
      />

      <CoaImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <MasterDeleteDialog
        open={Boolean(deleteId)}
        title="Hapus akun?"
        description="Akun yang masih punya child aktif tidak dapat dihapus."
        isDeleting={isDeleting}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
