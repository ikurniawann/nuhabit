"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Building,
  GitBranch,
  Warehouse,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useBusinessTree } from "../queries";
import {
  useCreateBusinessEntity,
  useDeleteBusinessEntity,
  useUpdateBusinessEntity,
} from "../mutations";
import {
  BUSINESS_CHILD_TYPE,
  BUSINESS_LEVEL_LABELS,
  type BusinessEntityType,
  type BusinessTreeNode,
} from "../types";
import {
  collectExpandableBusinessIds,
  countBusinessEntities,
  flattenBusinessTreeDisplay,
} from "../utils/business-tree";
import type { FlatBusinessTreeRow } from "../utils/business-tree";
import { toast } from "sonner";
import { BranchProfileDialog } from "./branch-profile-dialog";

const LEVEL_ICONS = {
  holding: Building2,
  company: Building,
  branch: GitBranch,
  warehouse: Warehouse,
} as const;

const LEVEL_COLORS = {
  holding: "bg-violet-50 text-violet-700",
  company: "bg-blue-50 text-blue-700",
  branch: "bg-emerald-50 text-emerald-700",
  warehouse: "bg-amber-50 text-amber-700",
} as const;

function TreeGuides({
  depth,
  isLast,
  parentContinuations,
}: {
  depth: number;
  isLast: boolean;
  parentContinuations: boolean[];
}) {
  if (depth === 0) return null;

  return (
    <span className="flex shrink-0 items-stretch" aria-hidden>
      {parentContinuations.map((continues, index) => (
        <span key={index} className="relative flex w-5 justify-center">
          {continues ? (
            <span className="absolute bottom-0 top-0 w-px bg-gray-200/90" />
          ) : null}
        </span>
      ))}
      <span className="relative flex w-5 items-center justify-center">
        <span className="absolute bottom-1/2 left-1/2 top-0 w-px bg-gray-200/90" />
        <span className="absolute left-1/2 top-1/2 h-px w-2.5 bg-gray-200/90" />
        <span className="relative z-1 font-mono text-[13px] leading-none text-gray-400">
          {isLast ? "└" : "├"}
        </span>
      </span>
    </span>
  );
}

function BusinessTreeRow({
  row,
  expandedIds,
  onToggleExpand,
  onEdit,
  onAddChild,
  onDelete,
  onProfile,
}: {
  row: FlatBusinessTreeRow;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onEdit: (node: BusinessTreeNode) => void;
  onAddChild: (node: BusinessTreeNode) => void;
  onDelete: (node: BusinessTreeNode) => void;
  onProfile: (node: BusinessTreeNode) => void;
}) {
  const { node, depth, hasChildren, isLast, parentContinuations } = row;
  const id = node.data.id;
  const isExpanded = expandedIds.has(id);
  const Icon = LEVEL_ICONS[node.kind];
  const childType = BUSINESS_CHILD_TYPE[node.kind];

  return (
    <tr className="border-b border-gray-200/50 transition-colors hover:bg-gray-50/80">
      <td className="px-4 py-3">
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: depth * 4 }}
        >
          <TreeGuides
            depth={depth}
            isLast={isLast}
            parentContinuations={parentContinuations}
          />
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleExpand(id)}
              className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="mr-1 inline-block h-6 w-6 shrink-0" />
          )}
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${LEVEL_COLORS[node.kind]}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 pl-2">
            <p className="truncate font-medium text-gray-900">
              {node.data.name}
            </p>
            <p className="truncate font-mono text-xs text-gray-400">
              {node.data.code}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge
          variant="outline"
          className={`border-0 font-medium ${LEVEL_COLORS[node.kind]}`}
        >
          {BUSINESS_LEVEL_LABELS[node.kind]}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {node.kind === "warehouse" && node.data.is_default ? (
          <Badge className="border-0 bg-gray-100 font-normal text-gray-600">
            Default
          </Badge>
        ) : (
          <Badge
            className={
              node.data.is_active
                ? "border-0 bg-emerald-50 font-normal text-emerald-700"
                : "border-0 bg-gray-100 font-normal text-gray-500"
            }
          >
            {node.data.is_active ? "Aktif" : "Nonaktif"}
          </Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {childType ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onAddChild(node)}
              className="h-8 gap-1 px-2 text-xs text-pink-600 hover:bg-pink-50 hover:text-pink-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {BUSINESS_LEVEL_LABELS[childType]}
            </Button>
          ) : null}
          {node.kind === "branch" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onProfile(node)}
              className="h-8 gap-1 px-2 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-800"
              title="Profil publik cabang"
            >
              <Globe className="h-3.5 w-3.5" />
              Profil
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onEdit(node)}
            className="h-8 w-8 p-0 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onDelete(node)}
            className="h-8 w-8 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

type FormMode = "create" | "edit";

interface FormState {
  name: string;
  code: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", code: "", is_active: true };

export function BusinessConfigurationPage() {
  const { data: tree, isLoading, isError, error } = useBusinessTree();
  const createMutation = useCreateBusinessEntity();
  const updateMutation = useUpdateBusinessEntity();
  const deleteMutation = useDeleteBusinessEntity();

  // Node default terbuka; yang ditutup user dicatat di sini.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [formType, setFormType] = useState<BusinessEntityType>("holding");
  const [formParentId, setFormParentId] = useState<string | undefined>();
  const [editNode, setEditNode] = useState<BusinessTreeNode | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<BusinessTreeNode | null>(
    null,
  );
  const [profileNode, setProfileNode] = useState<BusinessTreeNode | null>(null);

  const businessTree = useMemo(() => tree ?? { holdings: [] }, [tree]);
  const counts = useMemo(
    () => countBusinessEntities(businessTree),
    [businessTree],
  );

  const expandedIds = useMemo(
    () =>
      new Set(
        collectExpandableBusinessIds(businessTree).filter(
          (id) => !collapsedIds.has(id),
        ),
      ),
    [businessTree, collapsedIds],
  );
  const displayRows = useMemo(
    () => flattenBusinessTreeDisplay(businessTree, expandedIds),
    [businessTree, expandedIds],
  );

  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error ? error.message : "Gagal memuat data business",
      );
    }
  }, [isError, error]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  function toggleExpand(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openCreate(type: BusinessEntityType, parentId?: string) {
    setFormMode("create");
    setFormType(type);
    setFormParentId(parentId);
    setEditNode(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openAddChild(node: BusinessTreeNode) {
    const childType = BUSINESS_CHILD_TYPE[node.kind];
    if (!childType) return;
    openCreate(childType, node.data.id);
  }

  function openEdit(node: BusinessTreeNode) {
    setFormMode("edit");
    setFormType(node.kind);
    setEditNode(node);
    setForm({
      name: node.data.name,
      code: node.data.code,
      is_active: node.data.is_active,
    });
    setFormOpen(true);
  }

  function openDelete(node: BusinessTreeNode) {
    setDeletingNode(node);
    setDeleteOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Nama wajib diisi");
      return;
    }

    try {
      if (formMode === "edit" && editNode) {
        await updateMutation.mutateAsync({
          type: editNode.kind,
          id: editNode.data.id,
          payload: {
            name: form.name.trim(),
            code: form.code.trim() || undefined,
            is_active: form.is_active,
          },
        });
        toast.success(
          `${BUSINESS_LEVEL_LABELS[editNode.kind]} berhasil diperbarui`,
        );
      } else {
        await createMutation.mutateAsync({
          type: formType,
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          parentId: formParentId,
          is_active: form.is_active,
        });
        toast.success(
          `${BUSINESS_LEVEL_LABELS[formType]} berhasil ditambahkan`,
        );
      }
      setFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    }
  }

  async function handleDelete() {
    if (!deletingNode) return;
    try {
      await deleteMutation.mutateAsync({
        type: deletingNode.kind,
        id: deletingNode.data.id,
      });
      toast.success(
        `${BUSINESS_LEVEL_LABELS[deletingNode.kind]} berhasil dihapus`,
      );
      setDeleteOpen(false);
      setDeletingNode(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  const formTitle =
    formMode === "edit"
      ? `Edit ${BUSINESS_LEVEL_LABELS[formType]}`
      : `Tambah ${BUSINESS_LEVEL_LABELS[formType]}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kelola struktur organisasi: Holding → Company → Branch → Stall
          </p>
        </div>
        <Button
          onClick={() => openCreate("holding")}
          className="h-10 gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700"
        >
          <Plus className="h-4 w-4" />
          Tambah Holding
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Holding", counts.holdings, Building2],
            ["Company", counts.companies, Building],
            ["Branch", counts.branches, GitBranch],
            ["Stall", counts.warehouses, Warehouse],
          ] as const
        ).map(([label, count, Icon]) => (
          <div
            key={label}
            className="rounded-xl border border-gray-200/70 bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <p className="mt-1 text-2xl font-bold text-gray-900">{count}</p>
          </div>
        ))}
      </div>

      <PurchasingListSection
        icon={Building2}
        title="Struktur Business"
        description="Holding berisi Company, Company berisi Branch, dan setiap Branch wajib memiliki minimal 1 Stall (Main Storage sebagai default)."
        toolbar={
          <p className="text-xs text-gray-400">
            Contoh: Prologe → Sulu → Sulu Bandung → Main Storage, Stall 1, …
          </p>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
          </div>
        ) : displayRows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-gray-400">
            Belum ada data business. Tambahkan Holding untuk memulai.
          </div>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Nama</th>
                  <th className="px-4 py-3 text-left font-semibold">Level</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <BusinessTreeRow
                    key={`${row.node.kind}-${row.node.data.id}`}
                    row={row}
                    expandedIds={expandedIds}
                    onToggleExpand={toggleExpand}
                    onEdit={openEdit}
                    onAddChild={openAddChild}
                    onDelete={openDelete}
                    onProfile={setProfileNode}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PurchasingListSection>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => !open && setFormOpen(false)}
      >
        <DialogPanel size="sm">
          <DialogPanelForm onSubmit={handleSave}>
            <DialogPanelHeader>
              <DialogPanelTitle>{formTitle}</DialogPanelTitle>
              <DialogPanelDescription>
                {formMode === "create" && formType === "branch"
                  ? "Cabang baru otomatis mendapat Main Storage sebagai stall default."
                  : formMode === "create" && formType === "warehouse"
                    ? "Nomor stall akan di-generate otomatis jika kode dikosongkan."
                    : "Perbarui informasi entitas business."}
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Nama *
                </label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder={`Nama ${BUSINESS_LEVEL_LABELS[formType].toLowerCase()}`}
                  className="focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600">
                  Kode
                </label>
                <Input
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="Opsional — auto-generate dari nama"
                  className="font-mono focus:border-pink-400 focus:ring-1 focus:ring-pink-100"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_active: e.target.checked }))
                  }
                  className="h-4 w-4 rounded accent-pink-600"
                />
                Aktif
              </label>
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={isSaving}
                className="border-gray-200/80"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-pink-600 hover:bg-pink-700"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan"
                )}
              </Button>
            </DialogFooter>
          </DialogPanelForm>
        </DialogPanel>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => !open && setDeleteOpen(false)}
      >
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>
              Hapus{" "}
              {deletingNode
                ? BUSINESS_LEVEL_LABELS[deletingNode.kind]
                : "Entitas"}
              ?
            </DialogPanelTitle>
            <DialogPanelDescription>
              {deletingNode?.kind === "warehouse" &&
              deletingNode.data.is_default
                ? "Main Storage tidak dapat dihapus jika masih satu-satunya stall di cabang ini."
                : "Entitas child akan ikut terhapus. Tindakan ini tidak dapat dibatalkan."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            {deletingNode ? (
              <p className="text-sm text-gray-700">
                <span className="font-medium">{deletingNode.data.name}</span>
                <span className="ml-2 font-mono text-xs text-gray-400">
                  ({deletingNode.data.code})
                </span>
              </p>
            ) : null}
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
              className="border-gray-200/80"
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={isDeleting}
              className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {isDeleting ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
      <BranchProfileDialog
        branchId={profileNode?.data.id ?? null}
        branchName={profileNode?.data.name ?? ""}
        onClose={() => setProfileNode(null)}
      />
    </div>
  );
}
