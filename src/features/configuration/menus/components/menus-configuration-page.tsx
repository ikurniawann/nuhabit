"use client";

import { useEffect, useMemo, useState } from "react";
import { PlusIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { ChevronsDownUp, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCreateMenu, useDeleteMenu, useUpdateMenu } from "../mutations";
import { useMenuDetail, useMenuList } from "../queries";
import type { CreateMenuPayload, MenuItem } from "@/lib/iam/menu-types";
import { MenuDetailSections } from "./menu-detail-sections";
import { MenuFormDialog } from "./menu-form-dialog";
import { MenuTreeTable } from "./menu-tree-table";
import { buildMenuTree, collectExpandableIds, filterMenusWithAncestors, flattenMenuTree, sortSiblings } from "../utils/menu-tree";
import { toast } from "sonner";

export function MenusConfigurationPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [menuTypeFilter, setMenuTypeFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // Node baru default terbuka; yang ditutup user dicatat di sini.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formMenuId, setFormMenuId] = useState<string | null>(null);
  const [formDefaultParentId, setFormDefaultParentId] = useState<string | null>(
    null,
  );

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingMenu, setDeletingMenu] = useState<MenuItem | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useMenuList();
  const createMenuMutation = useCreateMenu();
  const updateMenuMutation = useUpdateMenu();
  const deleteMenuMutation = useDeleteMenu();

  const {
    data: detailData,
    isLoading: detailLoading,
    isError: detailError,
  } = useMenuDetail(selectedId);

  const allRows = useMemo(() => data?.data ?? [], [data?.data]);
  const isFormSubmitting =
    createMenuMutation.isPending || updateMenuMutation.isPending;
  const isDeleting = deleteMenuMutation.isPending;

  const menuTypes = useMemo(() => {
    const types = new Set(allRows.map((row) => row.menuType).filter(Boolean));
    return Array.from(types).sort();
  }, [allRows]);

  const filteredItems = useMemo(
    () =>
      filterMenusWithAncestors(allRows, {
        search,
        status: statusFilter,
        menuType: menuTypeFilter,
      }),
    [allRows, search, statusFilter, menuTypeFilter],
  );

  const menuTree = useMemo(() => buildMenuTree(filteredItems), [filteredItems]);

  const expandableIds = useMemo(() => collectExpandableIds(menuTree), [menuTree]);
  const expandedIds = useMemo(
    () => new Set(expandableIds.filter((id) => !collapsedIds.has(id))),
    [expandableIds, collapsedIds],
  );
  const displayRows = useMemo(
    () => flattenMenuTree(menuTree, expandedIds),
    [menuTree, expandedIds],
  );

  useEffect(() => {
    if (isError) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load menu list",
      );
    }
  }, [isError, error]);

  function handleView(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  function handleDetailClose() {
    setDetailOpen(false);
    setSelectedId(null);
  }

  function handleOpenAdd() {
    setFormMode("create");
    setFormMenuId(null);
    setFormDefaultParentId(null);
    setFormOpen(true);
  }

  function handleOpenEdit(item: MenuItem) {
    setFormMode("edit");
    setFormMenuId(item.id);
    setFormDefaultParentId(null);
    setFormOpen(true);
  }

  function handleOpenDelete(item: MenuItem) {
    setDeletingMenu(item);
    setDeleteOpen(true);
  }

  async function handleFormSubmit(payload: CreateMenuPayload) {
    try {
      if (formMode === "edit" && formMenuId) {
        await updateMenuMutation.mutateAsync({ id: formMenuId, ...payload });
        toast.success("Menu updated successfully");
      } else {
        await createMenuMutation.mutateAsync(payload);
        toast.success("Menu added successfully");
      }
      setFormOpen(false);
      setFormMenuId(null);
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save menu",
      );
    }
  }

  async function handleConfirmDelete() {
    if (!deletingMenu || isDeleting) return;

    try {
      await deleteMenuMutation.mutateAsync(deletingMenu.id);
      toast.success("Menu deleted successfully");
      setDeleteOpen(false);
      setDeletingMenu(null);

      if (selectedId === deletingMenu.id) {
        handleDetailClose();
      }
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete menu",
      );
    }
  }

  async function handleReorder(item: MenuItem, direction: "up" | "down") {
    if (reorderingId) return;

    const siblings = sortSiblings(
      allRows.filter((row) => row.parentId === item.parentId),
    );
    const index = siblings.findIndex((row) => row.id === item.id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;

    const next = [...siblings];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

    // Normalisasi order semua sibling (1..n) agar duplikat orderNumber ikut rapi.
    const changes = next
      .map((row, i) => ({
        id: row.id,
        orderNumber: i + 1,
        previous: row.orderNumber,
      }))
      .filter((change) => change.previous !== change.orderNumber);

    if (changes.length === 0) return;

    setReorderingId(item.id);
    try {
      await Promise.all(
        changes.map(({ id, orderNumber }) =>
          updateMenuMutation.mutateAsync({ id, orderNumber }),
        ),
      );
      toast.success("Menu order updated");
    } catch (reorderError) {
      toast.error(
        reorderError instanceof Error
          ? reorderError.message
          : "Failed to update menu order",
      );
    } finally {
      setReorderingId(null);
    }
  }

  async function handleChangeOrder(item: MenuItem, orderNumber: number) {
    if (reorderingId || orderNumber === item.orderNumber) return;

    setReorderingId(item.id);
    try {
      await updateMenuMutation.mutateAsync({ id: item.id, orderNumber });
      toast.success("Menu order updated");
    } catch (reorderError) {
      toast.error(
        reorderError instanceof Error
          ? reorderError.message
          : "Failed to update menu order",
      );
    } finally {
      setReorderingId(null);
    }
  }

  function toggleExpand(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setCollapsedIds(new Set());
  }

  function collapseAll() {
    setCollapsedIds(new Set(expandableIds));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Squares2X2Icon className="h-6 w-6 text-pink-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Menu Management</h1>
            <p className="text-sm text-gray-500">
              IAM sidebar menu hierarchy — tree view ({displayRows.length} shown
              / {allRows.length} total)
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={handleOpenAdd}
          className="gap-2 bg-pink-600 text-white hover:bg-pink-700"
        >
          <PlusIcon className="h-4 w-4" />
          Add Menu
        </Button>
      </div>

      <Card className="gap-0 border-gray-200/70 py-0">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-gray-200/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search name, code, or route..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 pl-9"
                />
              </label>
              <Select
                value={statusFilter || "all"}
                onValueChange={(value) =>
                  setStatusFilter(value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="h-9 w-full sm:w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={menuTypeFilter || "all"}
                onValueChange={(value) =>
                  setMenuTypeFilter(value === "all" ? "" : value)
                }
              >
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <SelectValue placeholder="Menu type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {menuTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {allRows.length} menus
              </span>
              <button
                type="button"
                onClick={expandAll}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200/80 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />
                Expand
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200/80 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                <ChevronsDownUp className="h-3.5 w-3.5 text-gray-400" />
                Collapse
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <p className="mb-1 text-sm font-medium text-gray-700">
                Failed to load menus
              </p>
              <p className="mb-3 text-xs text-gray-500">
                {error instanceof Error
                  ? error.message
                  : "A server error occurred"}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-lg border border-pink-200 px-3 py-1.5 text-sm font-medium text-pink-700 hover:bg-pink-50"
              >
                Try again
              </button>
            </div>
          ) : displayRows.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              No menus found
            </div>
          ) : (
            <MenuTreeTable
              rows={displayRows}
              expandedIds={expandedIds}
              selectedId={selectedId}
              reorderingId={reorderingId}
              onToggleExpand={toggleExpand}
              onView={handleView}
              onEdit={handleOpenEdit}
              onDelete={handleOpenDelete}
              onReorder={handleReorder}
              onChangeOrder={handleChangeOrder}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => !open && handleDetailClose()}
      >
        <DialogPanel size="md">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {detailData?.menuName ?? "Detail Menu"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {detailData?.code
                ? `Code: ${detailData.code} — permission context & metadata`
                : "IAM menu information and permission context"}
            </DialogPanelDescription>
          </DialogPanelHeader>

          <DialogPanelBody>
            {detailLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-pink-500" />
              </div>
            ) : detailError ? (
              <p className="text-sm text-gray-500">
                Failed to load menu details
              </p>
            ) : detailData ? (
              <MenuDetailSections detail={detailData} />
            ) : null}
          </DialogPanelBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleDetailClose}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <MenuFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        menuId={formMenuId}
        defaultParentId={formDefaultParentId}
        menus={allRows}
        isSubmitting={isFormSubmitting}
        onSubmit={handleFormSubmit}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteOpen(false);
            setDeletingMenu(null);
          }
        }}
      >
        <DialogPanel size="xs">
          <DialogPanelHeader>
            <DialogPanelTitle>Delete Menu?</DialogPanelTitle>
            <DialogPanelDescription>
              Are you sure you want to delete &quot;{deletingMenu?.menuName}
              &quot;? The menu will be deactivated and removed from the list.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
